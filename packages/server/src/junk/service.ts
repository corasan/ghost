import type { BungieNotLinked } from "@ghost/contract"
import { Context, DateTime, Effect, Layer } from "effect"
import { Jev } from "../agent/jev.ts"
import type { BungieError } from "../bungie/client.ts"
import { isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import { Loadouts } from "../bungie/loadouts.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { AppConfig } from "../config.ts"
import { BuildsRepo } from "../db/builds.ts"
import { checkRoll, scoreFor } from "../wishlist/parse.ts"
import { Wishlist, type WishlistError } from "../wishlist/wishlist.ts"
import { cachedJev, JevAnswers } from "./cache.ts"
import { judge, type RollStanding, type Verdict } from "./judge.ts"
import { itemText } from "./text.ts"

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
    const answers = yield* JevAnswers
    const config = yield* AppConfig
    const jev = cachedJev(yield* Jev, answers, config.jev.model)

    const judgeVault = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const saved = yield* builds.list.pipe(Effect.orDie)
      const game = yield* loadouts.current
      const weapons = inv.items.filter((item) => isWeapon(item.slot))
      const rolls = yield* wishlist.rollsFor(weapons.map((item) => item.itemHash))
      const plugs = yield* manifest.lookup([
        ...inv.items.flatMap((item) => item.plugHashes),
        ...[...rolls.values()].flat().flatMap((roll) => roll.perkHashes),
      ])
      const nameOf = (hash: number) => plugs.get(hash)?.name
      const judged = new Map(
        weapons.map((item) => {
          const list = rolls.get(item.itemHash) ?? []
          const check = checkRoll(item.plugHashes, list, nameOf)
          return [
            item.itemInstanceId,
            { check, ...scoreFor(check.full, check.partial, list.length) },
          ]
        }),
      )
      const standings = new Map(
        [...judged].map(([id, { check, score }]): readonly [string, RollStanding] => [
          id,
          { wishlist: check.full.some((match) => !match.roll.trash), trash: check.trash, score },
        ]),
      )
      const describe = (item: OwnedItem) => {
        const roll = judged.get(item.itemInstanceId)
        const text = itemText(item, plugs)
        return roll === undefined ? text : `${text}; community wishlist: ${roll.basis}`
      }
      const verdicts = yield* judge(
        inv,
        {
          builds: new Set(
            saved.flatMap((build) => build.plan.rows.map((row) => row.itemInstanceId)),
          ),
          loadouts: new Set(
            [...game.byCharacter.values()].flat().flatMap((loadout) => loadout.itemInstanceIds),
          ),
          purposes: saved.flatMap((build) =>
            build.recipe.purpose?.trim()
              ? [{ name: build.name, purpose: build.recipe.purpose }]
              : [],
          ),
          rolls: standings,
          describe,
          now: DateTime.toEpochMillis(yield* DateTime.now),
        },
        jev,
      )
      return { items: new Map(inv.items.map((item) => [item.itemInstanceId, item])), verdicts }
    })

    return { judgeVault }
  }),
)
