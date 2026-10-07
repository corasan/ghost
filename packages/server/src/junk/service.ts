import type { BungieNotLinked } from "@ghost/contract"
import { Context, DateTime, Effect, Layer } from "effect"
import type { BungieError } from "../bungie/client.ts"
import { isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import { Loadouts } from "../bungie/loadouts.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { BuildsRepo } from "../db/builds.ts"
import { checkRoll, scoreFor } from "../wishlist/parse.ts"
import { Wishlist, type WishlistError } from "../wishlist/wishlist.ts"
import { judge, type RollStanding, type Verdict } from "./judge.ts"

export interface Judgment {
  readonly items: ReadonlyMap<string, OwnedItem>
  readonly verdicts: ReadonlyMap<string, Verdict>
}

export interface JunkJudgeService {
  /** Judges every weapon and armor piece the player owns. Fails rather than guess when a protection cannot be read. */
  readonly judgeVault: Effect.Effect<Judgment, BungieError | BungieNotLinked | WishlistError>
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

    const judgeVault = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const saved = yield* builds.list.pipe(Effect.orDie)
      const game = yield* loadouts.current
      const weapons = inv.items.filter((item) => isWeapon(item.slot))
      const rolls = yield* wishlist.rollsFor(weapons.map((item) => item.itemHash))
      const plugs = yield* manifest.lookup([
        ...weapons.flatMap((item) => item.plugHashes),
        ...[...rolls.values()].flat().flatMap((roll) => roll.perkHashes),
      ])
      const nameOf = (hash: number) => plugs.get(hash)?.name
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
        now: DateTime.toEpochMillis(yield* DateTime.now),
      })
      return { items: new Map(inv.items.map((item) => [item.itemInstanceId, item])), verdicts }
    })

    return { judgeVault }
  }),
)
