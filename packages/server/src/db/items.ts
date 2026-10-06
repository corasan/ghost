import type { ItemDecision, ItemLocation } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import type { SeenInfo } from "../bungie/inventory.ts"

// items_seen remembers every item instance Ghost has ever seen in the
// profile: when it first showed up, where it is now, and what the player
// decided about it. Rows are written by sync, which runs on every fresh
// profile load, so "recent" means "first appeared in a profile since".

export interface SeenRow {
  readonly itemInstanceId: string
  readonly itemHash: number
  readonly name: string | null
  readonly location: ItemLocation
  readonly source: string
  readonly decision: ItemDecision | null
  readonly jobId: string | null
  readonly firstSeenAt: string
  readonly lastSeenAt: string
}

interface ItemRow {
  readonly item_instance_id: string
  readonly item_hash: number
  readonly name: string | null
  readonly location: string
  readonly source: string
  readonly decision: string | null
  readonly job_id: string | null
  readonly first_seen_at: string
  readonly last_seen_at: string
}

const asLocation = (value: string): ItemLocation =>
  value === "postmaster" || value === "character" ? value : "vault"

const asDecision = (value: string | null): ItemDecision | null =>
  value === "keep" || value === "junk" ? value : null

const fromRow = (row: ItemRow): SeenRow => ({
  itemInstanceId: row.item_instance_id,
  itemHash: row.item_hash,
  name: row.name,
  location: asLocation(row.location),
  source: row.source,
  decision: asDecision(row.decision),
  jobId: row.job_id,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
})

export interface SyncItem {
  readonly itemInstanceId: string
  readonly itemHash: number
  readonly name: string
  readonly location: ItemLocation
}

export const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000

export interface ItemsRepoService {
  readonly sync: (items: ReadonlyArray<SyncItem>) => Effect.Effect<void, SqlError.SqlError>
  /** Non-baseline items first seen in the last 48 hours, newest first. */
  readonly recent: Effect.Effect<ReadonlyArray<SeenRow>, SqlError.SqlError>
  /** Non-baseline items first seen after `since`. */
  readonly newSince: (since: string) => Effect.Effect<ReadonlyArray<SeenRow>, SqlError.SqlError>
  readonly get: (itemInstanceId: string) => Effect.Effect<Option.Option<SeenRow>, SqlError.SqlError>
  readonly setDecision: (
    itemInstanceId: string,
    decision: ItemDecision | null,
  ) => Effect.Effect<Option.Option<SeenRow>, SqlError.SqlError>
  readonly decisions: Effect.Effect<ReadonlyMap<string, SeenInfo>, SqlError.SqlError>
  readonly tagJob: (
    itemInstanceIds: ReadonlyArray<string>,
    jobId: string,
  ) => Effect.Effect<void, SqlError.SqlError>
}

export class ItemsRepo extends Context.Service<ItemsRepo, ItemsRepoService>()("ItemsRepo") {}

const BATCH = 200

export const ItemsRepoLive = Layer.effect(
  ItemsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // Diffing in memory keeps a sync to one SELECT plus writes for what
    // actually changed, instead of an upsert per owned item.
    const sync = (items: ReadonlyArray<SyncItem>) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ item_instance_id: string; location: string }>`
          SELECT item_instance_id, location FROM items_seen
        `
        const known = new Map(rows.map((r) => [r.item_instance_id, r.location]))
        // On the very first sync everything is already owned, not new.
        const baseline = rows.length === 0 ? 1 : 0
        const now = DateTime.formatIso(yield* DateTime.now)
        const inserts = items
          .filter((item) => !known.has(item.itemInstanceId))
          .map((item) => ({
            item_instance_id: item.itemInstanceId,
            item_hash: item.itemHash,
            name: item.name,
            location: item.location,
            source: item.location === "postmaster" ? "postmaster" : "drop",
            first_seen_at: now,
            last_seen_at: now,
            baseline,
          }))
        const moved = items.filter((item) => {
          const location = known.get(item.itemInstanceId)
          return location !== undefined && location !== item.location
        })
        if (inserts.length === 0 && moved.length === 0) return
        yield* Effect.gen(function* () {
          for (let i = 0; i < inserts.length; i += BATCH) {
            yield* sql`INSERT INTO items_seen ${sql.insert(inserts.slice(i, i + BATCH))}`
          }
          for (const item of moved) {
            yield* sql`
              UPDATE items_seen SET location = ${item.location}, last_seen_at = ${now}
              WHERE item_instance_id = ${item.itemInstanceId}
            `
          }
        }).pipe(sql.withTransaction)
      })

    const recent = Effect.gen(function* () {
      const now = yield* DateTime.now
      const cutoff = DateTime.formatIso(DateTime.subtractDuration(now, RECENT_WINDOW_MS))
      const rows = yield* sql<ItemRow>`
        SELECT * FROM items_seen
        WHERE baseline = 0 AND first_seen_at > ${cutoff}
        ORDER BY first_seen_at DESC LIMIT 200
      `
      return rows.map(fromRow)
    })

    const newSince = (since: string) =>
      sql<ItemRow>`
        SELECT * FROM items_seen WHERE baseline = 0 AND first_seen_at > ${since}
        ORDER BY first_seen_at DESC
      `.pipe(Effect.map((rows) => rows.map(fromRow)))

    const get = (itemInstanceId: string) =>
      sql<ItemRow>`SELECT * FROM items_seen WHERE item_instance_id = ${itemInstanceId}`.pipe(
        Effect.map((rows) => Option.map(Option.fromNullishOr(rows[0]), fromRow)),
      )

    const setDecision = (itemInstanceId: string, decision: ItemDecision | null) =>
      sql`
        UPDATE items_seen SET decision = ${decision} WHERE item_instance_id = ${itemInstanceId}
      `.pipe(Effect.andThen(get(itemInstanceId)))

    const decisions = sql<{
      item_instance_id: string
      decision: string | null
      first_seen_at: string
      baseline: number
    }>`
      SELECT item_instance_id, decision, first_seen_at, baseline FROM items_seen
    `.pipe(
      Effect.map(
        (rows): ReadonlyMap<string, SeenInfo> =>
          new Map(
            rows.map((r) => [
              r.item_instance_id,
              {
                decision: asDecision(r.decision),
                firstSeenAt: r.first_seen_at,
                baseline: r.baseline === 1,
              },
            ]),
          ),
      ),
    )

    const tagJob = (itemInstanceIds: ReadonlyArray<string>, jobId: string) =>
      itemInstanceIds.length === 0
        ? Effect.void
        : sql`
            UPDATE items_seen SET job_id = ${jobId}
            WHERE ${sql.in("item_instance_id", itemInstanceIds)}
          `.pipe(Effect.asVoid)

    return { sync, recent, newSince, get, setDecision, decisions, tagJob }
  }),
)
