import type { DamageType, ItemSlot, ItemTier } from "@ghost/contract"
import { Context, Effect, Layer, Option, Redacted, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../config.ts"
import { Settings } from "../db/settings.ts"
import { BungieError } from "./client.ts"

// Bungie's API only ever gives you item *hashes*. Names, tiers, and slots
// live in the "manifest", a set of JSON blobs published with every game
// patch. We download the lite item definitions once (roughly 30 MB), keep the
// handful of fields we need in SQLite, and refresh when Bungie's version
// string changes. Lookups are then a local query, not a network call per item.
// The version check itself runs at most hourly, and looked-up definitions stay
// in memory, so a profile load does not touch the network or SQLite for them.

export interface ManifestItem {
  readonly hash: number
  readonly name: string
  readonly typeName: string
  readonly icon: string | null
  readonly tier: ItemTier
  readonly slot: ItemSlot
  readonly damageType: DamageType
  readonly bucketHash: number
  /** Bungie's DestinyClass: 0 titan, 1 hunter, 2 warlock, 3 any. */
  readonly classType: number
  /** Effect text from the current patch, for perks, mods and fragments. */
  readonly description: string
}

export interface Capacities {
  readonly vault: number
  readonly postmaster: number
}

/** Used only until Bungie's bucket definitions have been read once. */
export const FALLBACK_CAPACITIES: Capacities = { vault: 700, postmaster: 21 }

interface BucketDefinition {
  readonly itemCount?: number
}

export const capacitiesFrom = (
  buckets: Readonly<Record<string, BucketDefinition | undefined>>,
): Capacities => ({
  vault: buckets[BUCKETS.vault]?.itemCount || FALLBACK_CAPACITIES.vault,
  postmaster: buckets[BUCKETS.postmaster]?.itemCount || FALLBACK_CAPACITIES.postmaster,
})

/** Name and effect of an armor stat in the current patch, keyed by stat hash. */
export type StatFacts = Readonly<Record<string, { readonly name: string; readonly effect: string }>>

interface StatDefinition {
  readonly displayProperties?: { readonly name?: string; readonly description?: string }
}

export const statFactsFrom = (
  definitions: Readonly<Record<string, StatDefinition | undefined>>,
  hashes: ReadonlyArray<string>,
): StatFacts =>
  Object.fromEntries(
    hashes.flatMap((hash) => {
      const name = definitions[hash]?.displayProperties?.name
      return name === undefined || name === ""
        ? []
        : [[hash, { name, effect: definitions[hash]?.displayProperties?.description ?? "" }]]
    }),
  )

export interface ManifestShape {
  /** What Bungie calls each armor stat and says it does. Empty until first read. Never fails. */
  readonly statFacts: Effect.Effect<StatFacts>
  /** How many slots the vault and postmaster hold in the current patch. Never fails. */
  readonly capacities: Effect.Effect<Capacities>
  /** Make sure the local copy exists and is current. Cheap when nothing changed. */
  readonly ensure: Effect.Effect<void, BungieError>
  readonly lookup: (
    hashes: Iterable<number>,
  ) => Effect.Effect<ReadonlyMap<number, ManifestItem>, BungieError>
  /** Definitions whose name matches exactly (case-insensitive); several per name are common. */
  readonly findByName: (
    names: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ManifestItem>, BungieError>
}

export class Manifest extends Context.Service<Manifest, ManifestShape>()("Manifest") {}

// DestinyInventoryBucketDefinition hashes for the equipment slots we show.
export const BUCKETS = {
  kinetic: 1498876634,
  energy: 2465295065,
  power: 953998645,
  helmet: 3448274439,
  arms: 3551918588,
  chest: 14239492,
  legs: 20886954,
  class: 1585787867,
  postmaster: 215593132,
  vault: 138197802,
  subclass: 3284755031,
} as const

export const slotForBucket = (bucketHash: number): ItemSlot => {
  switch (bucketHash) {
    case BUCKETS.kinetic:
      return "kinetic"
    case BUCKETS.energy:
      return "energy"
    case BUCKETS.power:
      return "power"
    case BUCKETS.helmet:
      return "helmet"
    case BUCKETS.arms:
      return "arms"
    case BUCKETS.chest:
      return "chest"
    case BUCKETS.legs:
      return "legs"
    case BUCKETS.class:
      return "class"
    default:
      return "other"
  }
}

// Bungie's TierType enum: 2 basic, 3 common, 4 rare, 5 legendary, 6 exotic.
export const tierForType = (tierType: number): ItemTier => {
  switch (tierType) {
    case 6:
      return "exotic"
    case 5:
      return "legendary"
    case 4:
      return "rare"
    case 3:
    case 2:
      return "common"
    default:
      return "unknown"
  }
}

// Bungie's DamageType enum. 5 (raid) is unused for weapons.
export const damageForType = (damageType: number): DamageType => {
  switch (damageType) {
    case 1:
      return "kinetic"
    case 2:
      return "arc"
    case 3:
      return "solar"
    case 4:
      return "void"
    case 6:
      return "stasis"
    case 7:
      return "strand"
    default:
      return "none"
  }
}

type ManifestRow = {
  readonly hash: number
  readonly name: string
  readonly type_name: string
  readonly icon: string | null
  readonly tier_type: number
  readonly bucket_hash: number
  readonly item_type: number
  readonly damage_type: number
  readonly class_type: number
  readonly description: string | null
}

const rowToItem = (row: ManifestRow): ManifestItem => ({
  hash: row.hash,
  name: row.name,
  typeName: row.type_name,
  icon: row.icon === null ? null : `https://www.bungie.net${row.icon}`,
  tier: tierForType(row.tier_type),
  slot: slotForBucket(row.bucket_hash),
  damageType: damageForType(row.damage_type),
  bucketHash: row.bucket_hash,
  classType: row.class_type,
  description: row.description ?? "",
})

interface LiteDefinition {
  readonly displayProperties?: {
    readonly name?: string
    readonly icon?: string
    readonly description?: string
  }
  readonly itemTypeDisplayName?: string
  readonly itemType?: number
  readonly defaultDamageType?: number
  readonly classType?: number
  readonly talentGrid?: { readonly hudDamageType?: number }
  readonly inventory?: { readonly tierType?: number; readonly bucketTypeHash?: number }
}

interface ManifestIndex {
  readonly version: string
  readonly jsonWorldComponentContentPaths: Record<
    string,
    Record<string, string | undefined> | undefined
  >
}

const VERSION_KEY = "manifest.version"
const CAPACITIES_KEY = "manifest.capacities"
const CAPACITIES_VERSION_KEY = "manifest.capacities.version"
const STAT_FACTS_KEY = "manifest.statFacts"
const STAT_FACTS_VERSION_KEY = "manifest.statFacts.version"
const ARMOR_STAT_HASHES = [
  "2996146975",
  "392767087",
  "1943323491",
  "1735777505",
  "144602215",
  "4244567218",
]
const BATCH = 500
const CHECK_EVERY_MS = 60 * 60 * 1000

export const ManifestLive = Layer.effect(
  Manifest,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const settings = yield* Settings
    const sql = yield* SqlClient.SqlClient
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("X-API-Key", Redacted.value(config.bungie.apiKey)),
      ),
    )

    const transport = (error: unknown) =>
      new BungieError({ status: "Transport", message: String(error) })

    const fetchJson = (url: string) =>
      http.get(url).pipe(
        Effect.flatMap((response) => response.json),
        Effect.map((json): unknown => json),
        Effect.mapError(transport),
      )

    const replaceAll = (definitions: Record<string, LiteDefinition>) =>
      Effect.gen(function* () {
        const rows: Array<ManifestRow> = []
        // The lite definitions carry no `hash` field; the object key is the hash.
        for (const [key, def] of Object.entries(definitions)) {
          const hash = Number(key)
          const name = def.displayProperties?.name ?? ""
          if (!Number.isInteger(hash) || name === "") continue
          rows.push({
            hash,
            name,
            type_name: def.itemTypeDisplayName ?? "",
            icon: def.displayProperties?.icon ?? null,
            tier_type: def.inventory?.tierType ?? 0,
            bucket_hash: def.inventory?.bucketTypeHash ?? 0,
            item_type: def.itemType ?? 0,
            // Subclasses carry their element on the talent grid instead.
            damage_type: def.defaultDamageType || (def.talentGrid?.hudDamageType ?? 0),
            class_type: def.classType ?? 3,
            description: def.displayProperties?.description || null,
          })
        }
        yield* sql`DELETE FROM manifest_items`
        for (let i = 0; i < rows.length; i += BATCH) {
          yield* sql`INSERT INTO manifest_items ${sql.insert(rows.slice(i, i + BATCH))}`
        }
        return rows.length
      }).pipe(sql.withTransaction)

    const cache = new Map<number, ManifestItem>()
    const missing = new Set<number>()
    let checkedAt = 0
    // Two lookups racing at startup would otherwise both download the manifest.
    const lock = yield* Semaphore.make(1)

    let capacities: Capacities | null = null

    const refreshCapacities = (remote: ManifestIndex) =>
      Effect.gen(function* () {
        const stored = yield* settings.get(CAPACITIES_VERSION_KEY).pipe(Effect.orDie)
        if (Option.isSome(stored) && stored.value === remote.version) return
        const path = remote.jsonWorldComponentContentPaths.en?.DestinyInventoryBucketDefinition
        if (path === undefined) return
        const buckets = (yield* fetchJson(`https://www.bungie.net${path}`)) as Record<
          string,
          BucketDefinition
        >
        capacities = capacitiesFrom(buckets)
        yield* settings.set(CAPACITIES_KEY, JSON.stringify(capacities)).pipe(Effect.orDie)
        yield* settings.set(CAPACITIES_VERSION_KEY, remote.version).pipe(Effect.orDie)
        yield* Effect.logInfo(`manifest: vault holds ${capacities.vault}`)
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`manifest: capacities failed: ${error.message}`)),
      )

    let statFacts: StatFacts | null = null

    const refreshStatFacts = (remote: ManifestIndex) =>
      Effect.gen(function* () {
        const stored = yield* settings.get(STAT_FACTS_VERSION_KEY).pipe(Effect.orDie)
        if (Option.isSome(stored) && stored.value === remote.version) return
        const path = remote.jsonWorldComponentContentPaths.en?.DestinyStatDefinition
        if (path === undefined) return
        const definitions = (yield* fetchJson(`https://www.bungie.net${path}`)) as Record<
          string,
          StatDefinition
        >
        statFacts = statFactsFrom(definitions, ARMOR_STAT_HASHES)
        yield* settings.set(STAT_FACTS_KEY, JSON.stringify(statFacts)).pipe(Effect.orDie)
        yield* settings.set(STAT_FACTS_VERSION_KEY, remote.version).pipe(Effect.orDie)
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`manifest: stat facts failed: ${error.message}`)),
      )

    const ensure = Effect.gen(function* () {
      if (Date.now() - checkedAt < CHECK_EVERY_MS) return
      const index = (yield* fetchJson("https://www.bungie.net/Platform/Destiny2/Manifest/")) as {
        Response: ManifestIndex
      }
      const remote = index.Response
      yield* refreshCapacities(remote)
      yield* refreshStatFacts(remote)
      const local = yield* settings.get(VERSION_KEY).pipe(Effect.orDie)
      // An empty table means an earlier download stored nothing, so the saved
      // version cannot be trusted.
      const [stored] = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM manifest_items
      `.pipe(Effect.orDie)
      const populated = (stored?.count ?? 0) > 0
      if (populated && Option.isSome(local) && local.value === remote.version) {
        checkedAt = Date.now()
        return
      }
      const path = remote.jsonWorldComponentContentPaths.en?.DestinyInventoryItemLiteDefinition
      if (path === undefined) {
        return yield* new BungieError({ status: "Manifest", message: "no item definitions" })
      }
      yield* Effect.logInfo(`manifest: downloading ${remote.version}`)
      const definitions = (yield* fetchJson(`https://www.bungie.net${path}`)) as Record<
        string,
        LiteDefinition
      >
      const count = yield* replaceAll(definitions).pipe(Effect.orDie)
      yield* settings.set(VERSION_KEY, remote.version).pipe(Effect.orDie)
      cache.clear()
      missing.clear()
      checkedAt = Date.now()
      yield* Effect.logInfo(`manifest: stored ${count} items`)
    }).pipe(lock.withPermits(1))

    const lookup = (hashes: Iterable<number>) =>
      Effect.gen(function* () {
        yield* ensure
        const result = new Map<number, ManifestItem>()
        const unknown: Array<number> = []
        for (const hash of new Set(hashes)) {
          const hit = cache.get(hash)
          if (hit !== undefined) result.set(hash, hit)
          else if (!missing.has(hash)) unknown.push(hash)
        }
        for (let i = 0; i < unknown.length; i += BATCH) {
          const batch = unknown.slice(i, i + BATCH)
          const rows = yield* sql<ManifestRow>`
            SELECT * FROM manifest_items WHERE ${sql.in("hash", batch)}
          `.pipe(Effect.orDie)
          for (const row of rows) {
            const item = rowToItem(row)
            cache.set(row.hash, item)
            result.set(row.hash, item)
          }
          for (const hash of batch) if (!cache.has(hash)) missing.add(hash)
        }
        return result as ReadonlyMap<number, ManifestItem>
      })

    const findByName = (names: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        yield* ensure
        if (names.length === 0) return []
        const lowered = names.map((n) => n.toLowerCase())
        const rows = yield* sql<ManifestRow>`
          SELECT * FROM manifest_items WHERE lower(name) IN ${sql.in(lowered)}
          AND description IS NOT NULL LIMIT 200
        `.pipe(Effect.orDie)
        return rows.map(rowToItem)
      })

    const readCapacities = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (capacities !== null) return capacities
      const stored = Option.getOrNull(yield* settings.get(CAPACITIES_KEY).pipe(Effect.orDie))
      if (stored === null) return FALLBACK_CAPACITIES
      capacities = { ...FALLBACK_CAPACITIES, ...(JSON.parse(stored) as Partial<Capacities>) }
      return capacities
    })

    const readStatFacts = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (statFacts !== null) return statFacts
      const stored = Option.getOrNull(yield* settings.get(STAT_FACTS_KEY).pipe(Effect.orDie))
      statFacts = stored === null ? {} : (JSON.parse(stored) as StatFacts)
      return statFacts
    })

    return {
      capacities: readCapacities,
      statFacts: readStatFacts,
      ensure,
      lookup,
      findByName,
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
