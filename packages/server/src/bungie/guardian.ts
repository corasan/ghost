import { createHash } from "node:crypto"
import {
  type BungieNotLinked,
  ChargeEffect,
  GuardianCharacter,
  GuardianSituational,
  GuardianSnapshot,
  ItemSummary,
  Source,
  VaultSnapshot,
} from "@ghost/contract"
import { Context, Effect, Layer, Option } from "effect"
import { SituationalWriter } from "../agent/situational.ts"
import { ChargeEffects } from "../db/charge.ts"
import { Settings } from "../db/settings.ts"
import type { BungieError } from "./client.ts"
import { isArmor } from "./inventory.ts"
import { describeLoadout, loadoutPlugHashes } from "./loadout.ts"
import { Manifest, type ManifestItem } from "./manifest.ts"
import { describeArmorMods, socketsNow, withChargeEffects } from "./mods.ts"
import { ProfileStore } from "./profile.ts"

// The two read-only shapes the app renders, both cut from the cached
// inventory: a per-character summary and the vault.

export interface GuardianService {
  readonly snapshot: Effect.Effect<GuardianSnapshot, BungieError | BungieNotLinked>
  readonly vault: Effect.Effect<VaultSnapshot, BungieError | BungieNotLinked>
  readonly situational: (
    characterId: string,
  ) => Effect.Effect<GuardianSituational, BungieError | BungieNotLinked>
}

export class Guardian extends Context.Service<Guardian, GuardianService>()("Guardian") {}

export const GuardianLive = Layer.effect(
  Guardian,
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const manifest = yield* Manifest
    const chargeEffects = yield* ChargeEffects
    const settings = yield* Settings
    const writer = yield* SituationalWriter
    const writing = new Set<string>()

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
        statIcons: Object.fromEntries(
          Object.values(facts).flatMap((fact) => (fact.icon ? [[fact.name, fact.icon]] : [])),
        ),
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

    const situational = (characterId: string) =>
      Effect.gen(function* () {
        const inv = yield* profile.inventory
        const character = inv.characters.find((c) => c.characterId === characterId)
        if (character === undefined)
          return new GuardianSituational({ mods: [], summary: null, pending: false })
        const armor = inv.items.filter(
          (i) => i.equipped && i.characterId === characterId && isArmor(i.slot),
        )
        const hashes = armor.flatMap((i) => i.modSockets.map((socket) => socket.plugHash))
        const defs = yield* manifest
          .lookup(hashes)
          .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
        const plugs = yield* manifest.plugFacts(hashes)
        const facts = yield* manifest.statFacts
        const charged = armor.flatMap((item) =>
          describeArmorMods({
            sockets: socketsNow(item, defs, plugs),
            swaps: [],
            facts,
          }).armorMods.filter((mod) => mod.charged),
        )
        if (charged.length === 0)
          return new GuardianSituational({ mods: [], summary: null, pending: false })
        const loadout = describeLoadout({
          character,
          plugs: yield* manifest.plugFacts(loadoutPlugHashes(character)),
          facts,
        })
        const copies = new Map<string, number>()
        for (const mod of charged) copies.set(mod.name, (copies.get(mod.name) ?? 0) + 1)
        const conditions = [...loadout.aspects, ...loadout.fragments]
        const key = `situational.${createHash("sha1")
          .update(
            JSON.stringify([
              loadout.subclass,
              conditions.map((c) => c.name).sort(),
              [...copies].sort(),
            ]),
          )
          .digest("hex")}`

        const read = Effect.gen(function* () {
          const effects = yield* chargeEffects.forMods([...copies.keys()]).pipe(Effect.orDie)
          const summary = Option.getOrNull(yield* settings.get(key).pipe(Effect.orDie))
          return { effects, summary }
        })

        const stored = yield* read
        const missing = [...copies.keys()].filter((name) => !stored.effects.has(name.toLowerCase()))
        const complete = stored.summary !== null && missing.length === 0
        if (!complete && !writing.has(key)) {
          writing.add(key)
          yield* writer
            .write({
              subclass: [loadout.subclass, loadout.element].filter(Boolean).join(", "),
              conditions: conditions.map((c) => ({ name: c.name, description: c.description })),
              mods: [...copies].map(([name, count]) => ({
                name,
                copies: count,
                description: charged.find((mod) => mod.name === name)?.description ?? "",
                known: stored.effects.get(name.toLowerCase())?.effect ?? null,
              })),
            })
            .pipe(
              Effect.flatMap((written) =>
                Effect.all([
                  chargeEffects.record(
                    written.effects
                      .filter((e) => copies.has(e.mod))
                      .map((e) => ({
                        mod: e.mod,
                        effect: new ChargeEffect({
                          effect: e.effect,
                          source: new Source(e.source),
                        }),
                      })),
                  ),
                  settings.set(key, written.summary),
                ]),
              ),
              Effect.catchCause((cause) => Effect.logWarning("situational: not written", cause)),
              Effect.ensuring(Effect.sync(() => writing.delete(key))),
              Effect.forkDetach,
            )
        }
        return new GuardianSituational({
          mods: withChargeEffects(charged, stored.effects),
          summary: stored.summary,
          pending: writing.has(key),
        })
      })

    return { snapshot, vault, situational }
  }),
)
