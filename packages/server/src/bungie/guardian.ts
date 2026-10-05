import {
  type BungieNotLinked,
  GuardianCharacter,
  GuardianSnapshot,
  ItemSummary,
  VaultSnapshot,
} from "@ghost/contract"
import { Context, Effect, Layer } from "effect"
import type { BungieError } from "./client.ts"
import { ProfileStore } from "./profile.ts"

// The two read-only shapes the app renders, both cut from the cached
// inventory: a per-character summary and the vault.

export const VAULT_CAPACITY = 700
export const POSTMASTER_CAPACITY = 21

export interface GuardianShape {
  readonly snapshot: Effect.Effect<GuardianSnapshot, BungieError | BungieNotLinked>
  readonly vault: Effect.Effect<VaultSnapshot, BungieError | BungieNotLinked>
}

export class Guardian extends Context.Service<Guardian, GuardianShape>()("Guardian") {}

export const GuardianLive = Layer.effect(
  Guardian,
  Effect.gen(function* () {
    const profile = yield* ProfileStore

    const snapshot = Effect.gen(function* () {
      const inv = yield* profile.inventory
      return new GuardianSnapshot({
        characters: inv.characters.map(
          (c) =>
            new GuardianCharacter({
              ...c,
              equipment: inv.items
                .filter((i) => i.equipped && i.characterId === c.characterId && i.slot !== "other")
                .map((i) => new ItemSummary(i)),
            }),
        ),
        vaultCount: inv.vaultCount,
        vaultCapacity: VAULT_CAPACITY,
        postmasterCapacity: POSTMASTER_CAPACITY,
      })
    })

    const vault = Effect.gen(function* () {
      const inv = yield* profile.inventory
      return new VaultSnapshot({
        count: inv.vaultCount,
        capacity: VAULT_CAPACITY,
        items: inv.items
          .filter((i) => i.location === "vault")
          .sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
          .map((i) => new ItemSummary(i)),
      })
    })

    return { snapshot, vault }
  }),
)
