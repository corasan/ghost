import {
  type BungieNotLinked,
  type ItemAction,
  ItemDetail,
  ItemNotFound,
  ItemPerk,
  ItemSummary,
  type Job,
  type JobNotFound,
  Plan,
  type PlanNotApplicable,
  PlanRow,
  type SetBonus,
} from "@ghost/contract"
import { Context, Effect, Layer } from "effect"
import type { BungieError } from "../bungie/client.ts"
import type { CharacterInfo, OwnedItem } from "../bungie/inventory.ts"
import { Manifest, type ManifestItem } from "../bungie/manifest.ts"
import { armorStats } from "../bungie/masterwork.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { everySetBonus } from "../bungie/sets.ts"
import { JobsRepo } from "../db/jobs.ts"
import { Plans } from "../plans/executor.ts"

type ReadErrors = ItemNotFound | BungieError | BungieNotLinked

export interface ItemsService {
  readonly detail: (id: string) => Effect.Effect<ItemDetail, ReadErrors>
  readonly act: (
    id: string,
    input: ItemAction,
  ) => Effect.Effect<Job, ReadErrors | JobNotFound | PlanNotApplicable>
}

export class Items extends Context.Service<Items, ItemsService>()("Items") {}

const NOT_A_PERK = /shader|ornament|tracker|memento|transmat|emote|^empty |^default /i

export const perksFrom = (
  plugHashes: ReadonlyArray<number>,
  defs: ReadonlyMap<number, ManifestItem>,
): ReadonlyArray<ItemPerk> =>
  plugHashes.flatMap((hash) => {
    const plug = defs.get(hash)
    if (
      plug === undefined ||
      plug.description === "" ||
      NOT_A_PERK.test(plug.typeName) ||
      NOT_A_PERK.test(plug.name)
    ) {
      return []
    }
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

    const act = (id: string, input: ItemAction) =>
      Effect.gen(function* () {
        const { inv, item } = yield* find(id)
        const characterId = input.action === "to_vault" ? null : (input.characterId ?? null)
        const target = inv.characters.find((each) => each.characterId === characterId)
        const words = describeAction(item, input.action, target)
        const job = yield* jobs
          .createManual({
            kind: "item_action",
            prompt: words.prompt,
            characterId,
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
                  action: input.action,
                  characterId,
                  selected: true,
                  outcome: null,
                  error: null,
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

    return { detail, act }
  }),
)
