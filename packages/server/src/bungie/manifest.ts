import type { DamageType, ItemSlot, ItemTier } from "@ghost/contract"
import { Context, Effect, Layer, Option, Redacted } from "effect"
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

export interface ManifestItem {
  readonly hash: number
  readonly name: string
  readonly typeName: string
  readonly icon: string | null
  readonly tier: ItemTier
  readonly slot: ItemSlot
  readonly damageType: DamageType
  readonly bucketHash: number
}

export interface ManifestShape {
  /** Make sure the local copy exists and is current. Cheap when nothing changed. */
  readonly ensure: Effect.Effect<void, BungieError>
  readonly lookup: (
    hashes: Iterable<number>,
  ) => Effect.Effect<ReadonlyMap<number, ManifestItem>, BungieError>
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
})

interface LiteDefinition {
  readonly displayProperties?: { readonly name?: string; readonly icon?: string }
  readonly itemTypeDisplayName?: string
  readonly itemType?: number
  readonly defaultDamageType?: number
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
const BATCH = 500

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
            damage_type: def.defaultDamageType ?? 0,
          })
        }
        yield* sql`DELETE FROM manifest_items`
        for (let i = 0; i < rows.length; i += BATCH) {
          yield* sql`INSERT INTO manifest_items ${sql.insert(rows.slice(i, i + BATCH))}`
        }
        return rows.length
      }).pipe(sql.withTransaction)

    const ensure = Effect.gen(function* () {
      const index = (yield* fetchJson("https://www.bungie.net/Platform/Destiny2/Manifest/")) as {
        Response: ManifestIndex
      }
      const remote = index.Response
      const local = yield* settings.get(VERSION_KEY).pipe(Effect.orDie)
      // An empty table means an earlier download stored nothing, so the saved
      // version cannot be trusted.
      const [stored] = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM manifest_items
      `.pipe(Effect.orDie)
      const populated = (stored?.count ?? 0) > 0
      if (populated && Option.isSome(local) && local.value === remote.version) return
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
      yield* Effect.logInfo(`manifest: stored ${count} items`)
    })

    const lookup = (hashes: Iterable<number>) =>
      Effect.gen(function* () {
        yield* ensure
        const unique = Array.from(new Set(hashes))
        const result = new Map<number, ManifestItem>()
        for (let i = 0; i < unique.length; i += BATCH) {
          const rows = yield* sql<ManifestRow>`
            SELECT * FROM manifest_items WHERE ${sql.in("hash", unique.slice(i, i + BATCH))}
          `.pipe(Effect.orDie)
          for (const row of rows) result.set(row.hash, rowToItem(row))
        }
        return result as ReadonlyMap<number, ManifestItem>
      })

    return { ensure, lookup }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
