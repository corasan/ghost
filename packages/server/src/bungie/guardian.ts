import {
  type BungieNotLinked,
  GuardianCharacter,
  GuardianSnapshot,
  ItemSummary,
  VaultSnapshot,
} from "@ghost/contract"
import { Context, Effect, Layer } from "effect"
import type { BungieError } from "./client.ts"
import { describeLoadout, loadoutPlugHashes } from "./loadout.ts"
import { Manifest } from "./manifest.ts"
import { ProfileStore } from "./profile.ts"

// The two read-only shapes the app renders, both cut from the cached
// inventory: a per-character summary and the vault.

export interface GuardianShape {
  readonly snapshot: Effect.Effect<GuardianSnapshot, BungieError | BungieNotLinked>
  readonly vault: Effect.Effect<VaultSnapshot, BungieError | BungieNotLinked>
}

export class Guardian extends Context.Service<Guardian, GuardianShape>()("Guardian") {}

export const GuardianLive = Layer.effect(
  Guardian,
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const manifest = yield* Manifest

    const snapshot = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const capacities = yield* manifest.capacities
      const facts = yield* manifest.statFacts
      const plugs = yield* manifest.plugFacts(inv.characters.flatMap(loadoutPlugHashes))
      return new GuardianSnapshot({
        characters: inv.characters.map(
          (c) =>
            new GuardianCharacter({
              ...c,
              loadout: describeLoadout({ character: c, plugs, facts }),
              equipment: inv.items
                .filter((i) => i.equipped && i.characterId === c.characterId && i.slot !== "other")
                .map((i) => new ItemSummary(i)),
            }),
        ),
        vaultCount: inv.vaultCount,
        vaultCapacity: capacities.vault,
        postmasterCapacity: capacities.postmaster,
        elementIcons: yield* manifest.elementIcons,
      })
    })

    const vault = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const capacities = yield* manifest.capacities
      return new VaultSnapshot({
        count: inv.vaultCount,
        capacity: capacities.vault,
        items: inv.items
          .filter((i) => i.location === "vault")
          .sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
          .map((i) => new ItemSummary(i)),
      })
    })

    return { snapshot, vault }
  }),
)
