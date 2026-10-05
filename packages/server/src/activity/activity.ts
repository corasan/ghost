import {
  Briefing,
  type BungieNotLinked,
  type ItemDecision,
  ItemSummary,
  RecentItem,
} from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option } from "effect"
import type { BungieError } from "../bungie/client.ts"
import { POSTMASTER_CAPACITY, VAULT_CAPACITY } from "../bungie/guardian.ts"
import { type Inventory, isUpgrade, type OwnedItem, pickCharacter } from "../bungie/inventory.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { ActionsRepo } from "../db/actions.ts"
import { ItemsRepo, type SeenRow } from "../db/items.ts"
import { Settings } from "../db/settings.ts"
import { sessionWindow } from "./session.ts"

// What changed for the player: recently acquired items and the "since last
// time" briefing. Both join what items_seen remembers with the live
// inventory, so names, power and upgrade flags reflect the current profile.

const KEYS = { lastActiveAt: "session.lastActiveAt", since: "session.since" } as const

export interface ActivityShape {
  /** Never fails on Bungie: without a profile it falls back to manifest data. */
  readonly recent: (characterId?: string) => Effect.Effect<ReadonlyArray<RecentItem>>
  readonly decide: (
    itemInstanceId: string,
    decision: ItemDecision | null,
  ) => Effect.Effect<Option.Option<RecentItem>>
  readonly briefing: (
    characterId?: string,
  ) => Effect.Effect<Briefing, BungieError | BungieNotLinked>
}

export class Activity extends Context.Service<Activity, ActivityShape>()("Activity") {}

const fromOwned = (row: SeenRow, item: OwnedItem, upgrade: boolean) =>
  new RecentItem({
    ...row,
    name: item.name,
    typeName: item.typeName,
    icon: item.icon,
    tier: item.tier,
    slot: item.slot,
    power: item.power,
    location: item.location,
    upgrade,
  })

const startOfLocalDay = (nowMs: number) => {
  const day = new Date(nowMs)
  day.setHours(0, 0, 0, 0)
  return day.toISOString()
}

export const ActivityLive = Layer.effect(
  Activity,
  Effect.gen(function* () {
    const items = yield* ItemsRepo
    const actions = yield* ActionsRepo
    const settings = yield* Settings
    const manifest = yield* Manifest
    const profile = yield* ProfileStore

    const upgradeCheck = (inv: Inventory, characterId?: string) => {
      const character = pickCharacter(inv, characterId)
      return (item: OwnedItem) => character !== undefined && isUpgrade(item, character, inv.items)
    }

    const enrich = (rows: ReadonlyArray<SeenRow>, characterId?: string) =>
      Effect.gen(function* () {
        const inv = yield* Effect.option(profile.inventory)
        const owned = new Map(
          Option.match(inv, {
            onNone: () => [],
            onSome: (i) => i.items.map((item) => [item.itemInstanceId, item] as const),
          }),
        )
        const upgrade = Option.match(inv, {
          onNone: () => () => false,
          onSome: (i) => upgradeCheck(i, characterId),
        })
        // Items no longer owned (dismantled, or no profile right now) still
        // get names and icons from the manifest.
        const gone = rows.filter((r) => !owned.has(r.itemInstanceId))
        const defs = yield* manifest
          .lookup(gone.map((r) => r.itemHash))
          .pipe(Effect.orElseSucceed(() => new Map()))
        return rows.map((row) => {
          const item = owned.get(row.itemInstanceId)
          if (item !== undefined) return fromOwned(row, item, upgrade(item))
          const def = defs.get(row.itemHash)
          return new RecentItem({
            ...row,
            name: def?.name ?? row.name,
            typeName: def?.typeName ?? "",
            icon: def?.icon ?? null,
            tier: def?.tier ?? "unknown",
            slot: def?.slot ?? "other",
            power: null,
            upgrade: false,
          })
        })
      })

    const recent = (characterId?: string) =>
      Effect.flatMap(items.recent.pipe(Effect.orDie), (rows) => enrich(rows, characterId))

    const decide = (itemInstanceId: string, decision: ItemDecision | null) =>
      Effect.gen(function* () {
        const row = yield* items.setDecision(itemInstanceId, decision).pipe(Effect.orDie)
        if (Option.isNone(row)) return Option.none()
        const [item] = yield* enrich([row.value])
        return Option.fromNullishOr(item)
      })

    const session = Effect.gen(function* () {
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now)
      const lastActiveAt = Option.getOrNull(yield* settings.get(KEYS.lastActiveAt))
      const storedSince = Option.getOrNull(yield* settings.get(KEYS.since))
      const window = sessionWindow(nowMs, lastActiveAt, storedSince)
      if (window.started && window.since !== null) yield* settings.set(KEYS.since, window.since)
      yield* settings.set(KEYS.lastActiveAt, new Date(nowMs).toISOString())
      return { since: window.since, nowMs }
    }).pipe(Effect.orDie)

    const briefing = (characterId?: string) =>
      Effect.gen(function* () {
        const inv = yield* profile.inventory
        const { since, nowMs } = yield* session
        const character = pickCharacter(inv, characterId)
        const fresh = since === null ? [] : yield* items.newSince(since).pipe(Effect.orDie)
        const owned = new Map(inv.items.map((item) => [item.itemInstanceId, item]))
        const upgrade = upgradeCheck(inv, character?.characterId)
        const upgrades = fresh.flatMap((row) => {
          const item = owned.get(row.itemInstanceId)
          return item !== undefined && upgrade(item) ? [new ItemSummary(item)] : []
        })
        const recentRows = yield* items.recent.pipe(Effect.orDie)
        const actionsToday = yield* actions.countOkSince(startOfLocalDay(nowMs)).pipe(Effect.orDie)
        return new Briefing({
          since,
          newCount: fresh.length,
          upgrades,
          postmasterCount: character?.postmasterCount ?? 0,
          postmasterCapacity: POSTMASTER_CAPACITY,
          vaultCount: inv.vaultCount,
          vaultCapacity: VAULT_CAPACITY,
          recentCount: recentRows.length,
          undecidedCount: recentRows.filter((r) => r.decision === null).length,
          actionsToday,
        })
      })

    return { recent, decide, briefing }
  }),
)
