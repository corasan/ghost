import type { BungieNotLinked } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option } from "effect"
import type { BungieError } from "../bungie/client.ts"
import { isRolledTrait, isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import { Loadouts } from "../bungie/loadouts.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { BuildsRepo } from "../db/builds.ts"
import { PerkRatings, weaponKey } from "../db/perk-ratings.ts"
import { checkRoll, perkKey, scoreFor, WILDCARD_ITEM } from "../wishlist/parse.ts"
import { Wishlist, type WishlistError } from "../wishlist/wishlist.ts"
import { judge, type RollStanding, type Verdict } from "./judge.ts"
import { type PerkKnowledge, type Purpose, PURPOSES, type RatedColumns, ratePerk } from "./perks.ts"

export interface Judgment {
  readonly items: ReadonlyMap<string, OwnedItem>
  readonly verdicts: ReadonlyMap<string, Verdict>
  /** Each weapon's trait columns with every perk rated. */
  readonly columns: ReadonlyMap<string, RatedColumns>
}

type JudgeErrors = BungieError | BungieNotLinked | WishlistError

export interface JunkJudgeService {
  /** Judges every weapon and armor piece the player owns. Fails rather than guess when a protection cannot be read. */
  readonly judgeVault: Effect.Effect<Judgment, JudgeErrors>
  /** One owned weapon's trait columns, rated as judging rates them; none for armor or an unknown item. */
  readonly perksOf: (
    itemInstanceId: string,
  ) => Effect.Effect<
    Option.Option<{ readonly item: OwnedItem; readonly columns: RatedColumns }>,
    JudgeErrors
  >
}

export class JunkJudge extends Context.Service<JunkJudge, JunkJudgeService>()("JunkJudge") {}

export const JunkJudgeLive = Layer.effect(
  JunkJudge,
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const builds = yield* BuildsRepo
    const loadouts = yield* Loadouts
    const wishlist = yield* Wishlist
    const manifest = yield* Manifest
    const ratings = yield* PerkRatings

    const rate = (weapons: ReadonlyArray<OwnedItem>) =>
      Effect.gen(function* () {
        const rolls = yield* wishlist.rollsFor(weapons.map((item) => item.itemHash))
        const recommended = yield* wishlist.recommended
        const plugs = yield* manifest.lookup([
          ...weapons.flatMap((item) => item.plugHashes),
          ...[...rolls.values()].flat().flatMap((roll) => roll.perkHashes),
          ...recommended.map((pair) => pair.perkHash),
        ])
        const nameOf = (hash: number) => plugs.get(hash)?.name
        const traitKey = (hash: number) => {
          const plug = plugs.get(hash)
          return plug !== undefined && isRolledTrait(plug.typeName) ? perkKey(plug.name) : null
        }
        const weaponsByPerk = new Map<string, Set<number>>()
        for (const { itemHash, perkHash } of recommended) {
          const key = traitKey(perkHash)
          if (key !== null)
            weaponsByPerk.set(key, (weaponsByPerk.get(key) ?? new Set()).add(itemHash))
        }
        const community = new Map([...weaponsByPerk].map(([key, hashes]) => [key, hashes.size]))
        const stored = yield* ratings
          .forWeapons(weapons.map((item) => item.name))
          .pipe(Effect.orDie)
        const nameOfWeapon = new Map(weapons.map((item) => [item.itemHash, item.name]))
        const knowledge = (itemHash: number): PerkKnowledge => {
          const own = (rolls.get(itemHash) ?? []).filter((roll) => roll.itemHash !== WILDCARD_ITEM)
          const named = (trash: boolean, purpose?: Purpose) => {
            const counts = new Map<string, number>()
            const fits = (tags: ReadonlyArray<string>) => {
              const lowered = tags.map((tag) => tag.toLowerCase())
              const tagged = PURPOSES.filter((each) => lowered.includes(each))
              return purpose === undefined || tagged.length === 0 || tagged.includes(purpose)
            }
            for (const roll of own.filter(
              (each) => each.trash === trash && fits(each.block.tags),
            )) {
              for (const key of new Set(roll.perkHashes.flatMap((hash) => traitKey(hash) ?? []))) {
                counts.set(key, (counts.get(key) ?? 0) + 1)
              }
            }
            return counts
          }
          return {
            stored: stored.get(weaponKey(nameOfWeapon.get(itemHash) ?? "")) ?? new Map(),
            wishlisted: { pve: named(false, "pve"), pvp: named(false, "pvp") },
            trashed: new Set(named(true).keys()),
            community,
          }
        }
        const known = new Map(
          [...new Set(weapons.map((item) => item.itemHash))].map((hash) => [hash, knowledge(hash)]),
        )
        const columnTops = new Map<number, Array<Record<Purpose, number>>>()
        for (const item of weapons) {
          const tops = columnTops.get(item.itemHash) ?? []
          const wishlisted = known.get(item.itemHash)?.wishlisted
          item.traits.forEach((column, index) => {
            const top = tops[index] ?? { pve: 0, pvp: 0 }
            for (const name of column) {
              for (const purpose of PURPOSES) {
                const count = wishlisted?.[purpose].get(perkKey(name)) ?? 0
                top[purpose] = Math.max(top[purpose], count)
              }
            }
            tops[index] = top
          })
          columnTops.set(item.itemHash, tops)
        }
        const columns = new Map(
          weapons.map((item): readonly [string, RatedColumns] => {
            const knowing = known.get(item.itemHash) ?? knowledge(item.itemHash)
            const tops = columnTops.get(item.itemHash) ?? []
            return [
              item.itemInstanceId,
              item.traits.map((column, index) =>
                column.map((name) => ratePerk(name, knowing, tops[index] ?? { pve: 0, pvp: 0 })),
              ),
            ]
          }),
        )
        return { columns, rolls, nameOf }
      })

    const judgeVault = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const saved = yield* builds.list.pipe(Effect.orDie)
      const game = yield* loadouts.current
      const weapons = inv.items.filter((item) => isWeapon(item.slot))
      const { columns, rolls, nameOf } = yield* rate(weapons)
      const rollStandings = new Map(
        weapons.map((item): readonly [string, RollStanding] => {
          const list = rolls.get(item.itemHash) ?? []
          const check = checkRoll(item.plugHashes, list, nameOf)
          return [
            item.itemInstanceId,
            {
              wishlist: check.full.some((match) => !match.roll.trash),
              trash: check.trash,
              score: scoreFor(check.full, check.partial, list.length).score,
            },
          ]
        }),
      )
      const verdicts = judge(inv, {
        builds: new Set(saved.flatMap((build) => build.plan.rows.map((row) => row.itemInstanceId))),
        loadouts: new Set(
          [...game.byCharacter.values()].flat().flatMap((loadout) => loadout.itemInstanceIds),
        ),
        rolls: rollStandings,
        columns,
        now: DateTime.toEpochMillis(yield* DateTime.now),
      })
      return {
        items: new Map(inv.items.map((item) => [item.itemInstanceId, item])),
        verdicts,
        columns,
      }
    })

    const perksOf = (itemInstanceId: string) =>
      Effect.gen(function* () {
        const inv = yield* profile.inventory
        const item = inv.items.find((each) => each.itemInstanceId === itemInstanceId)
        if (item === undefined || !isWeapon(item.slot)) return Option.none()
        const copies = inv.items.filter((each) => each.name === item.name)
        const { columns } = yield* rate(copies)
        return Option.some({ item, columns: columns.get(itemInstanceId) ?? [] })
      })

    return { judgeVault, perksOf }
  }),
)
