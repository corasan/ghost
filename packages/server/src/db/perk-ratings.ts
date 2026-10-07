import { Context, DateTime, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import type { Rating, StoredRating } from "../junk/perks.ts"
import { perkKey } from "../wishlist/parse.ts"

export interface PerkRatingRow {
  readonly itemHash: number
  readonly perk: string
  readonly source: StoredRating["source"]
  readonly rating: Rating
  readonly note: string | null
  readonly url: string | null
}

export interface PerkRatingsService {
  /** Each weapon's ratings by perkKey, a player's rating winning over Claude's. */
  readonly forItems: (
    itemHashes: ReadonlyArray<number>,
  ) => Effect.Effect<ReadonlyMap<number, ReadonlyMap<string, StoredRating>>, SqlError.SqlError>
  readonly rows: (
    itemHash: number,
  ) => Effect.Effect<ReadonlyArray<PerkRatingRow>, SqlError.SqlError>
  readonly set: (row: PerkRatingRow) => Effect.Effect<void, SqlError.SqlError>
  readonly clear: (
    itemHash: number,
    perk: string,
    source: StoredRating["source"],
  ) => Effect.Effect<void, SqlError.SqlError>
}

export class PerkRatings extends Context.Service<PerkRatings, PerkRatingsService>()(
  "PerkRatings",
) {}

interface Row {
  readonly item_hash: number
  readonly perk: string
  readonly source: StoredRating["source"]
  readonly rating: Rating
  readonly note: string | null
  readonly url: string | null
}

const BATCH = 500

export const PerkRatingsLive = Layer.effect(
  PerkRatings,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const forItems = (itemHashes: ReadonlyArray<number>) =>
      Effect.forEach(
        Array.from({ length: Math.ceil(itemHashes.length / BATCH) }, (_, i) =>
          itemHashes.slice(i * BATCH, (i + 1) * BATCH),
        ),
        (part) => sql<Row>`SELECT * FROM perk_ratings WHERE item_hash IN ${sql.in(part)}`,
      ).pipe(
        Effect.map((parts) => {
          const byItem = new Map<number, Map<string, StoredRating>>()
          for (const row of parts.flat()) {
            const ratings = byItem.get(row.item_hash) ?? new Map<string, StoredRating>()
            if (row.source === "player" || !ratings.has(row.perk)) {
              ratings.set(row.perk, { rating: row.rating, source: row.source })
            }
            byItem.set(row.item_hash, ratings)
          }
          return byItem
        }),
      )

    const rows = (itemHash: number) =>
      sql<Row>`SELECT * FROM perk_ratings WHERE item_hash = ${itemHash} ORDER BY perk`.pipe(
        Effect.map((found) =>
          found.map((row): PerkRatingRow => ({
            itemHash: row.item_hash,
            perk: row.perk,
            source: row.source,
            rating: row.rating,
            note: row.note,
            url: row.url,
          })),
        ),
      )

    const set = (row: PerkRatingRow) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO perk_ratings (item_hash, perk, source, rating, note, url, updated_at)
          VALUES (${row.itemHash}, ${perkKey(row.perk)}, ${row.source}, ${row.rating},
            ${row.note}, ${row.url}, ${now})
          ON CONFLICT (item_hash, perk, source) DO UPDATE SET rating = excluded.rating,
            note = excluded.note, url = excluded.url, updated_at = excluded.updated_at
        `
      })

    const clear = (itemHash: number, perk: string, source: StoredRating["source"]) =>
      sql`
        DELETE FROM perk_ratings
        WHERE item_hash = ${itemHash} AND perk = ${perkKey(perk)} AND source = ${source}
      `.pipe(Effect.asVoid)

    return { forItems, rows, set, clear }
  }),
)
