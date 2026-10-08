import {
  type ApplyPerks,
  ArmorMod,
  type BungieNotLinked,
  type ItemAction,
  ItemDetail,
  ItemNotFound,
  ItemPerk,
  ItemSummary,
  type Job,
  type JobNotFound,
  Plan,
  PlanNotApplicable,
  PlanRow,
  type SetBonus,
  type WeaponSheet,
} from "@ghost/contract"
import { Context, Effect, Layer } from "effect"
import type { BungieError } from "../bungie/client.ts"
import { type CharacterInfo, isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import { Manifest, type ManifestItem } from "../bungie/manifest.ts"
import { armorStats } from "../bungie/masterwork.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { everySetBonus } from "../bungie/sets.ts"
import { JobsRepo } from "../db/jobs.ts"
import { JunkJudge } from "../junk/service.ts"
import { Plans } from "../plans/executor.ts"
import type { WishlistError } from "../wishlist/wishlist.ts"
import { poolColumns, weaponSheet } from "./sheet.ts"

type ReadErrors = ItemNotFound | BungieError | BungieNotLinked

export interface ItemsService {
  readonly detail: (id: string) => Effect.Effect<ItemDetail, ReadErrors>
  readonly act: (
    id: string,
    input: ItemAction,
  ) => Effect.Effect<Job, ReadErrors | JobNotFound | PlanNotApplicable>
  /** A weapon's perk sockets with every perk each can roll, rated, and its stats. */
  readonly sheet: (id: string) => Effect.Effect<WeaponSheet, ReadErrors | WishlistError>
  /** Swaps rolled perks into a weapon, carrying it to a character first when it is not on one. */
  readonly applyPerks: (
    id: string,
    input: ApplyPerks,
  ) => Effect.Effect<Job, ReadErrors | JobNotFound | PlanNotApplicable>
}

export class Items extends Context.Service<Items, ItemsService>()("Items") {}

const NOT_A_PERK = /shader|ornament|tracker|memento|transmat|emote|^empty |^default /i

export const isPerk = (plug: ManifestItem) =>
  plug.description !== "" && !NOT_A_PERK.test(plug.typeName) && !NOT_A_PERK.test(plug.name)

export const perksFrom = (
  plugHashes: ReadonlyArray<number>,
  defs: ReadonlyMap<number, ManifestItem>,
): ReadonlyArray<ItemPerk> =>
  plugHashes.flatMap((hash) => {
    const plug = defs.get(hash)
    if (plug === undefined || !isPerk(plug)) return []
    return [
      new ItemPerk({
        name: plug.name,
        description: plug.description,
        icon: plug.icon,
        trait: plug.typeName.includes("Trait"),
        enhanced: plug.typeName.startsWith("Enhanced "),
      }),
    ]
  })

/** Every bonus of the piece's set, counting the pieces of it the piece's character wears. */
export const pieceSetBonuses = (
  item: OwnedItem,
  items: ReadonlyArray<OwnedItem>,
): ReadonlyArray<SetBonus> | undefined => {
  if (item.set === null) return undefined
  const members = new Set(item.set.items)
  const worn =
    item.location === "character"
      ? items.filter(
          (each) =>
            each.equipped && each.characterId === item.characterId && members.has(each.itemHash),
        ).length
      : 0
  return everySetBonus(item.set, worn)
}

export const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export const describeAction = (
  item: Pick<OwnedItem, "name">,
  action: ItemAction["action"],
  target: Pick<CharacterInfo, "classType"> | undefined,
) => {
  const who = target === undefined ? "character" : title(target.classType)
  switch (action) {
    case "to_vault":
      return {
        prompt: `Send ${item.name} to the vault`,
        title: "TRANSFER",
        meta: "TO VAULT",
        confirmLabel: "SEND TO VAULT",
      }
    case "to_character":
      return {
        prompt: `Send ${item.name} to ${who}`,
        title: "TRANSFER",
        meta: `TO ${who.toUpperCase()}`,
        confirmLabel: `SEND TO ${who.toUpperCase()}`,
      }
    case "equip":
      return {
        prompt: `Equip ${item.name} on ${who}`,
        title: "EQUIP",
        meta: `EQUIP ON ${who.toUpperCase()}`,
        confirmLabel: `EQUIP ON ${who.toUpperCase()}`,
      }
  }
}

export const ItemsLive = Layer.effect(
  Items,
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const manifest = yield* Manifest
    const jobs = yield* JobsRepo
    const plans = yield* Plans
    const judge = yield* JunkJudge

    const find = (id: string) =>
      Effect.gen(function* () {
        const inv = yield* profile.inventory
        const item = inv.items.find((each) => each.itemInstanceId === id)
        if (item === undefined) return yield* new ItemNotFound({ id })
        return { inv, item }
      })

    const detail = (id: string) =>
      Effect.gen(function* () {
        const { inv, item } = yield* find(id)
        const defs = yield* manifest.lookup(item.plugHashes)
        return new ItemDetail({
          item: new ItemSummary(item),
          perks: perksFrom(item.plugHashes, defs),
          stats: armorStats(item),
          setBonuses: pieceSetBonuses(item, inv.items),
          exoticPerk: item.exoticPerk ?? undefined,
        })
      })

    const runRow = (
      item: OwnedItem,
      words: { prompt: string; title: string; meta: string; confirmLabel: string },
      row: Pick<PlanRow, "action" | "characterId" | "armorMods">,
    ) =>
      Effect.gen(function* () {
        const job = yield* jobs
          .createManual({
            kind: "item_action",
            prompt: words.prompt,
            characterId: row.characterId,
            plan: new Plan({
              kind: "transfer",
              title: words.title,
              subtitle: null,
              stats: [],
              featured: null,
              rows: [
                new PlanRow({
                  itemInstanceId: item.itemInstanceId,
                  itemHash: item.itemHash,
                  name: item.name,
                  icon: item.icon,
                  tier: item.tier,
                  meta: words.meta,
                  power: item.power,
                  score: null,
                  selected: true,
                  outcome: null,
                  error: null,
                  ...row,
                }),
              ],
              note: null,
              confirmLabel: words.confirmLabel,
              status: "proposed",
            }),
          })
          .pipe(Effect.orDie)
        return yield* plans.apply(job.id, [item.itemInstanceId])
      })

    const act = (id: string, input: ItemAction) =>
      Effect.gen(function* () {
        const { inv, item } = yield* find(id)
        const characterId = input.action === "to_vault" ? null : (input.characterId ?? null)
        const target = inv.characters.find((each) => each.characterId === characterId)
        return yield* runRow(item, describeAction(item, input.action, target), {
          action: input.action,
          characterId,
        })
      })

    const sheet = (id: string) =>
      Effect.gen(function* () {
        const { item } = yield* find(id)
        if (!isWeapon(item.slot)) return yield* new ItemNotFound({ id })
        const pools = yield* manifest.weaponPerkPools(item.itemHash)
        const defs = yield* manifest.lookup([
          ...item.weaponSockets.flatMap((socket) => [socket.plugHash, ...socket.rolled]),
          ...pools.flatMap((pool) => pool.pool),
        ])
        const columns = poolColumns(item, pools, defs, isPerk)
        const rated = yield* judge.rateColumns(
          item,
          columns.map((column) => column.plugs.map((each) => each.plug.name)),
        )
        const investments = yield* manifest.plugInvestments(
          columns.flatMap((column) => column.plugs.map((each) => each.plug.hash)),
        )
        return weaponSheet(item, columns, rated, investments)
      })

    const applyPerks = (id: string, input: ApplyPerks) =>
      Effect.gen(function* () {
        const { inv, item } = yield* find(id)
        const defs = yield* manifest.lookup(
          item.weaponSockets.flatMap((socket) => [socket.plugHash, ...socket.rolled]),
        )
        const swaps: Array<ArmorMod> = []
        for (const { socketIndex, plugHash } of input.plugs) {
          const socket = item.weaponSockets.find((each) => each.index === socketIndex)
          const plug = defs.get(plugHash)
          if (socket === undefined || plug === undefined || !socket.rolled.includes(plugHash)) {
            return yield* new PlanNotApplicable({
              reason: `${plug?.name ?? "That perk"} can't be applied to this copy`,
            })
          }
          if (socket.plugHash === plugHash) continue
          swaps.push(
            new ArmorMod({
              name: plug.name,
              description: plug.description,
              icon: plug.icon,
              cost: 0,
              mods: [],
              swap: true,
              replaces: defs.get(socket.plugHash)?.name ?? null,
              socketIndex,
              plugHash,
              previousPlugHash: socket.plugHash,
            }),
          )
        }
        if (swaps.length === 0) {
          return yield* new PlanNotApplicable({ reason: "Those perks are already on this copy" })
        }
        const carried = item.location === "character" && item.characterId !== null
        const characterId = carried ? item.characterId : input.characterId
        const target = inv.characters.find((each) => each.characterId === characterId)
        const who = target === undefined ? "CHARACTER" : title(target.classType).toUpperCase()
        const count = `${swaps.length} PERK${swaps.length === 1 ? "" : "S"}`
        return yield* runRow(
          item,
          {
            prompt: `Apply ${swaps.map((swap) => swap.name).join(" and ")} to ${item.name}`,
            title: "APPLY PERKS",
            meta: carried ? count : `${count} · MOVES TO ${who} FIRST`,
            confirmLabel: `APPLY ${count}`,
          },
          { action: carried ? "none" : "to_character", characterId, armorMods: swaps },
        )
      })

    return { detail, act, sheet, applyPerks }
  }),
)
