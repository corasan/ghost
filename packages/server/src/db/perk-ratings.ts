import { Context, DateTime, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import type { Rating, StoredRating } from "../junk/perks.ts"
import { perkKey } from "../wishlist/parse.ts"

export interface PerkRatingRow {
  readonly weapon: string
  readonly perk: string
  readonly source: StoredRating["source"]
  readonly rating: Rating
  readonly note: string | null
  readonly url: string | null
}

/** How a weapon's name is stored: lowercase, so "Gnawing Hunger" and "gnawing hunger" meet. */
export const weaponKey = (name: string) => name.trim().toLowerCase()

export interface PerkRatingsService {
  /** Each weapon's ratings by perkKey, keyed by weaponKey, a player's rating winning over Claude's. */
  readonly forWeapons: (
    names: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, ReadonlyMap<string, StoredRating>>, SqlError.SqlError>
  /** Every stored rating, or one weapon's, sorted by weapon then perk. */
  readonly rows: (weapon?: string) => Effect.Effect<ReadonlyArray<PerkRatingRow>, SqlError.SqlError>
  readonly set: (row: PerkRatingRow) => Effect.Effect<void, SqlError.SqlError>
  readonly clear: (
    weapon: string,
    perk: string,
    source: StoredRating["source"],
  ) => Effect.Effect<void, SqlError.SqlError>
}

export class PerkRatings extends Context.Service<PerkRatings, PerkRatingsService>()(
  "PerkRatings",
) {}

interface Row {
  readonly weapon: string
  readonly perk: string
  readonly source: StoredRating["source"]
  readonly rating: Rating
  readonly note: string | null
  readonly url: string | null
}

const BATCH = 500

const toRow = (row: Row): PerkRatingRow => ({ ...row })

export const PerkRatingsLive = Layer.effect(
  PerkRatings,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const forWeapons = (names: ReadonlyArray<string>) => {
      const keys = [...new Set(names.map(weaponKey))]
      return Effect.forEach(
        Array.from({ length: Math.ceil(keys.length / BATCH) }, (_, i) =>
          keys.slice(i * BATCH, (i + 1) * BATCH),
        ),
        (part) => sql<Row>`SELECT * FROM perk_ratings WHERE weapon IN ${sql.in(part)}`,
      ).pipe(
        Effect.map((parts) => {
          const byWeapon = new Map<string, Map<string, StoredRating>>()
          for (const row of parts.flat()) {
            const ratings = byWeapon.get(row.weapon) ?? new Map<string, StoredRating>()
            if (row.source === "player" || !ratings.has(row.perk)) {
              ratings.set(row.perk, { rating: row.rating, source: row.source })
            }
            byWeapon.set(row.weapon, ratings)
          }
          return byWeapon
        }),
      )
    }

    const rows = (weapon?: string) =>
      (weapon === undefined
        ? sql<Row>`SELECT * FROM perk_ratings ORDER BY weapon, perk`
        : sql<Row>`SELECT * FROM perk_ratings WHERE weapon = ${weaponKey(weapon)} ORDER BY perk`
      ).pipe(Effect.map((found) => found.map(toRow)))

    const set = (row: PerkRatingRow) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO perk_ratings (weapon, perk, source, rating, note, url, updated_at)
          VALUES (${weaponKey(row.weapon)}, ${perkKey(row.perk)}, ${row.source}, ${row.rating},
            ${row.note}, ${row.url}, ${now})
          ON CONFLICT (weapon, perk, source) DO UPDATE SET rating = excluded.rating,
            note = excluded.note, url = excluded.url, updated_at = excluded.updated_at
        `
      })

    const clear = (weapon: string, perk: string, source: StoredRating["source"]) =>
      sql`
        DELETE FROM perk_ratings
        WHERE weapon = ${weaponKey(weapon)} AND perk = ${perkKey(perk)} AND source = ${source}
      `.pipe(Effect.asVoid)

    return { forWeapons, rows, set, clear }
  }),
)
