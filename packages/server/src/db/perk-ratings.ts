import { Context, DateTime, Effect, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Rating, StoredRating } from '../junk/perks.ts'
import { perkKey } from '../wishlist/parse.ts'

export interface PerkRatingRow {
  readonly weapon: string
  readonly perk: string
  readonly source: StoredRating['source']
  readonly purpose: StoredRating['purpose']
  readonly rating: Rating
  readonly note: string | null
  readonly url: string | null
}

/** How a weapon's name is stored: lowercase, so "Gnawing Hunger" and "gnawing hunger" meet. */
export const weaponKey = (name: string) => name.trim().toLowerCase()

export interface PerkRatingsService {
  /** Each weapon's ratings by perkKey, keyed by weaponKey. */
  readonly forWeapons: (
    names: ReadonlyArray<string>,
  ) => Effect.Effect<
    ReadonlyMap<string, ReadonlyMap<string, ReadonlyArray<StoredRating>>>,
    SqlError.SqlError
  >
  /** Every stored rating, or one weapon's, sorted by weapon then perk. */
  readonly rows: (weapon?: string) => Effect.Effect<ReadonlyArray<PerkRatingRow>, SqlError.SqlError>
  readonly set: (row: PerkRatingRow) => Effect.Effect<void, SqlError.SqlError>
  readonly clear: (
    weapon: string,
    perk: string,
    source: StoredRating['source'],
    purpose: StoredRating['purpose'],
  ) => Effect.Effect<void, SqlError.SqlError>
}

export class PerkRatings extends Context.Service<PerkRatings, PerkRatingsService>()(
  'PerkRatings',
) {}

interface Row {
  readonly weapon: string
  readonly perk: string
  readonly source: StoredRating['source']
  readonly purpose: StoredRating['purpose']
  readonly rating: Rating
  readonly note: string | null
  readonly url: string | null
}

const BATCH = 500

const toRow = (row: Row): PerkRatingRow => ({
  weapon: row.weapon,
  perk: row.perk,
  source: row.source,
  purpose: row.purpose,
  rating: row.rating,
  note: row.note,
  url: row.url,
})

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
        (part) =>
          sql<Row>`
            SELECT * FROM perk_ratings WHERE weapon IN ${sql.in(part)}
            ORDER BY weapon, perk, source, purpose
          `,
      ).pipe(
        Effect.map((parts) => {
          const byWeapon = new Map<string, Map<string, Array<StoredRating>>>()
          for (const row of parts.flat()) {
            const ratings = byWeapon.get(row.weapon) ?? new Map<string, Array<StoredRating>>()
            ratings.set(row.perk, [
              ...(ratings.get(row.perk) ?? []),
              { rating: row.rating, source: row.source, purpose: row.purpose },
            ])
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
          INSERT INTO perk_ratings (weapon, perk, source, purpose, rating, note, url, updated_at)
          VALUES (${weaponKey(row.weapon)}, ${perkKey(row.perk)}, ${row.source}, ${row.purpose},
            ${row.rating}, ${row.note}, ${row.url}, ${now})
          ON CONFLICT (weapon, perk, source, purpose) DO UPDATE SET rating = excluded.rating,
            note = excluded.note, url = excluded.url, updated_at = excluded.updated_at
        `
      })

    const clear = (
      weapon: string,
      perk: string,
      source: StoredRating['source'],
      purpose: StoredRating['purpose'],
    ) =>
      sql`
        DELETE FROM perk_ratings
        WHERE weapon = ${weaponKey(weapon)} AND perk = ${perkKey(perk)} AND source = ${source}
          AND purpose = ${purpose}
      `.pipe(Effect.asVoid)

    return { forWeapons, rows, set, clear }
  }),
)
