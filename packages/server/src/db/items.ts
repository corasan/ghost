import { type ItemDecision, type ItemLocation, RecentItem } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

interface ItemRow {
  readonly item_instance_id: string
  readonly item_hash: number
  readonly name: string | null
  readonly location: string
  readonly source: string
  readonly decision: string | null
  readonly first_seen_at: string
  readonly last_seen_at: string
}

const decodeItem = Schema.decodeUnknownEffect(RecentItem)
const rowToItem = (row: ItemRow) =>
  decodeItem({
    itemInstanceId: row.item_instance_id,
    itemHash: row.item_hash,
    name: row.name,
    location: row.location,
    source: row.source,
    decision: row.decision,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }).pipe(Effect.orDie)

export interface SeenItem {
  readonly itemInstanceId: string
  readonly itemHash: number
  readonly name: string | null
  readonly location: ItemLocation
  readonly source?: string | undefined
}

export interface ItemsRepoShape {
  // Upsert: new instance ids get first_seen_at = now, known ones only bump
  // last_seen_at and location. "Recent" is then ordered by first_seen_at,
  // which is exactly "what did I just pull from the postmaster".
  readonly markSeen: (items: ReadonlyArray<SeenItem>) => Effect.Effect<void, SqlError.SqlError>
  readonly recent: Effect.Effect<ReadonlyArray<RecentItem>, SqlError.SqlError>
  readonly setDecision: (
    itemInstanceId: string,
    decision: ItemDecision | null,
  ) => Effect.Effect<Option.Option<RecentItem>, SqlError.SqlError>
}

export class ItemsRepo extends Context.Service<ItemsRepo, ItemsRepoShape>()("ItemsRepo") {}

export const ItemsRepoLive = Layer.effect(
  ItemsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const markSeen = (items: ReadonlyArray<SeenItem>) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* Effect.forEach(
          items,
          (item) => sql`
            INSERT INTO items_seen (item_instance_id, item_hash, name, location, source, first_seen_at, last_seen_at)
            VALUES (${item.itemInstanceId}, ${item.itemHash}, ${item.name}, ${item.location}, ${item.source ?? "unknown"}, ${now}, ${now})
            ON CONFLICT(item_instance_id) DO UPDATE SET
              location = excluded.location,
              name = COALESCE(excluded.name, items_seen.name),
              last_seen_at = excluded.last_seen_at
          `,
          { discard: true },
        )
      })

    const recent = sql<ItemRow>`
      SELECT * FROM items_seen ORDER BY first_seen_at DESC LIMIT 50
    `.pipe(Effect.flatMap(Effect.forEach(rowToItem)))

    const setDecision = (itemInstanceId: string, decision: ItemDecision | null) =>
      Effect.gen(function* () {
        yield* sql`
          UPDATE items_seen SET decision = ${decision} WHERE item_instance_id = ${itemInstanceId}
        `
        const rows = yield* sql<ItemRow>`
          SELECT * FROM items_seen WHERE item_instance_id = ${itemInstanceId}
        `
        const row = rows[0]
        return row === undefined ? Option.none() : Option.some(yield* rowToItem(row))
      })

    return { markSeen, recent, setDecision }
  }),
)
