import { createHash } from "node:crypto"
import {
  type BungieNotLinked,
  ChargeEffect,
  GuardianCharacter,
  GuardianSituational,
  GuardianSnapshot,
  ItemSummary,
  SlottedMod,
  Source,
  VaultSnapshot,
} from "@ghost/contract"
import { Clock, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { SituationalWriter } from "../agent/situational.ts"
import { ChargeEffects } from "../db/charge.ts"
import { Settings } from "../db/settings.ts"
import type { BungieError } from "./client.ts"
import { isArmor, isPerk, isWeapon, type OwnedItem } from "./inventory.ts"
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

const SUMMARIES_KEY = "situational.summaries"
const MAX_SUMMARIES = 50
const RETRY_FAILED_MS = 60 * 60 * 1000

const decodeSummaries = Schema.decodeOption(
  Schema.fromJsonString(Schema.Array(Schema.Tuple([Schema.String, Schema.String]))),
)

export const GuardianLive = Layer.effect(
  Guardian,
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const manifest = yield* Manifest
    const chargeEffects = yield* ChargeEffects
    const settings = yield* Settings
    const writer = yield* SituationalWriter
    const writing = new Set<string>()
    // When each loadout's last write failed, so a failing model is not
    // called again on every request.
    const failedAt = new Map<string, number>()
    const summariesLock = yield* Semaphore.make(1)

    // Summaries live in one settings row, newest first and capped, instead
    // of a row per loadout ever worn.
    const readSummaries = settings.get(SUMMARIES_KEY).pipe(
      Effect.orDie,
      Effect.map((raw) =>
        raw.pipe(
          Option.flatMap(decodeSummaries),
          Option.getOrElse((): ReadonlyArray<readonly [string, string]> => []),
        ),
      ),
    )

    const saveSummary = (key: string, summary: string) =>
      Effect.gen(function* () {
        const kept = (yield* readSummaries).filter(([known]) => known !== key)
        const next = [[key, summary] as const, ...kept].slice(0, MAX_SUMMARIES)
        yield* settings.set(SUMMARIES_KEY, JSON.stringify(next))
      }).pipe(summariesLock.withPermits(1))

    // A summary from before they shared a row is moved over when read.
    const summaryFor = (key: string) =>
      Effect.gen(function* () {
        const found = (yield* readSummaries).find(([known]) => known === key)
        if (found !== undefined) return found[1]
        const legacy = Option.getOrNull(yield* settings.get(key).pipe(Effect.orDie))
        if (legacy === null) return null
        yield* saveSummary(key, legacy).pipe(Effect.orDie)
        yield* settings.remove(key).pipe(Effect.orDie)
        return legacy
      })

    const snapshot = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const capacities = yield* manifest.capacities
      const facts = yield* manifest.statFacts
      const plugs = yield* manifest.plugFacts(inv.characters.flatMap(loadoutPlugHashes))
      const onCharacters = inv.items.filter((i) => i.location === "character" && i.slot !== "other")
      const modDefs = yield* manifest
        .lookup(
          onCharacters.flatMap((i) => [
            ...i.modSockets.map((socket) => socket.plugHash),
            ...i.weaponSockets.map((socket) => socket.plugHash),
          ]),
        )
        .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
      const weaponHashes = [
        ...new Set(onCharacters.filter((i) => isWeapon(i.slot)).map((i) => i.itemHash)),
      ]
      const perkSockets = new Map(
        yield* Effect.forEach(
          weaponHashes,
          (hash) =>
            manifest
              .weaponPerkSockets(hash)
              .pipe(Effect.map((sockets) => [hash, sockets] as const)),
          { concurrency: 8 },
        ),
      )
      const slotted = (def: ManifestItem) => new SlottedMod({ name: def.name, icon: def.icon })
      const perksOf = (item: OwnedItem) => {
        const sockets = new Set(perkSockets.get(item.itemHash) ?? [])
        return item.weaponSockets.flatMap((socket) => {
          const def = modDefs.get(socket.plugHash)
          return sockets.has(socket.index) && def !== undefined && isPerk(def) ? [slotted(def)] : []
        })
      }
      const summary = (item: OwnedItem) =>
        new ItemSummary({
          ...item,
          mods: isArmor(item.slot)
            ? item.modSockets.map((socket) => {
                const def = modDefs.get(socket.plugHash)
                return socket.empty || def === undefined ? null : slotted(def)
              })
            : isWeapon(item.slot)
              ? perksOf(item)
              : undefined,
        })
      return new GuardianSnapshot({
        characters: inv.characters.map(
          (c) =>
            new GuardianCharacter({
              ...c,
              loadout: describeLoadout({ character: c, plugs, facts }),
              equipment: onCharacters
                .filter((i) => i.equipped && i.characterId === c.characterId)
                .map(summary),
              carried: onCharacters
                .filter((i) => !i.equipped && i.characterId === c.characterId)
                .map(summary),
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
          const summary = yield* summaryFor(key)
          return { effects, summary }
        })

        const stored = yield* read
        const missing = [...copies.keys()].filter((name) => !stored.effects.has(name.toLowerCase()))
        const complete = stored.summary !== null && missing.length === 0
        const now = yield* Clock.currentTimeMillis
        const coolingOff = now - (failedAt.get(key) ?? -Infinity) < RETRY_FAILED_MS
        if (!complete && !writing.has(key) && !coolingOff) {
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
                  saveSummary(key, written.summary),
                ]),
              ),
              Effect.tap(() => Effect.sync(() => failedAt.delete(key))),
              Effect.catchCause((cause) =>
                Effect.andThen(
                  Effect.sync(() => failedAt.set(key, now)),
                  Effect.logWarning("situational: not written", cause),
                ),
              ),
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
