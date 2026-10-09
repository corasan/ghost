import { Source } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { SqlClient } from "effect/sql"
import { Settings } from "../db/settings.ts"
import { parseWishlist, type StoredRoll, WILDCARD_ITEM, type WishlistBlock } from "./parse.ts"

const decodeTags = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Schema.String)))
const decodePerkHashes = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Schema.Number)))

// Roll quality comes from DIM's curated community wishlist (the file DIM
// subscribes to by default), not from the model's memory. It is downloaded
// into SQLite and re-checked at most every 12 hours with If-None-Match;
// raw.githubusercontent.com sends an ETag but no Last-Modified, so "as of"
// is when we first saw the current ETag.

export const WISHLIST_URL =
  "https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt"
const REFRESH_MS = 12 * 60 * 60 * 1000
const DOWNLOAD_TIMEOUT = "2 minutes"
const BATCH = 500

const KEYS = {
  etag: "wishlist.etag",
  fetchedAt: "wishlist.fetchedAt",
  changedAt: "wishlist.changedAt",
} as const

export class WishlistError extends Schema.TaggedError<WishlistError>()("WishlistError", {
  message: Schema.String,
}) {}

export interface WishlistService {
  /** Download or revalidate when the local copy is older than 12 hours. */
  readonly ensure: Effect.Effect<void, WishlistError>
  /** Rolls per item hash in file order, wildcard rolls appended to each. */
  readonly rollsFor: (
    itemHashes: Iterable<number>,
  ) => Effect.Effect<ReadonlyMap<number, ReadonlyArray<StoredRoll>>, WishlistError>
  /** Every weapon and perk pair the wishlist recommends, outside trash and wildcard rolls. */
  readonly recommended: Effect.Effect<
    ReadonlyArray<{ readonly itemHash: number; readonly perkHash: number }>,
    WishlistError
  >
  /** When the current file content first appeared; null before the first download. */
  readonly asOf: Effect.Effect<string | null>
  /** Citation for the wishlist itself. */
  readonly source: Effect.Effect<Source>
}

export class Wishlist extends Context.Service<Wishlist, WishlistService>()("Wishlist") {}

interface JoinedRow {
  readonly item_hash: number
  readonly perk_hashes: string
  readonly trash: number
  readonly block_id: number
  readonly notes: string | null
  readonly tags: string
  readonly section_title: string | null
  readonly section_description: string | null
  readonly section_url: string | null
  readonly section_date: string | null
}

export const WishlistLive = Layer.effect(
  Wishlist,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const settings = yield* Settings
    const http = yield* HttpClient.HttpClient
    const lock = yield* Semaphore.make(1)
    // One object per block id, so callers can group rolls by block identity.
    const blocks = new Map<number, WishlistBlock>()
    let pairs: ReadonlyArray<{ readonly itemHash: number; readonly perkHash: number }> | null = null

    const fail = (cause: unknown) => new WishlistError({ message: String(cause) })
    const setting = (key: string) =>
      settings.get(key).pipe(Effect.orDie, Effect.map(Option.getOrNull))

    const store = (text: string) =>
      Effect.gen(function* () {
        const parsed = parseWishlist(text)
        yield* sql`DELETE FROM wishlist_rolls`
        yield* sql`DELETE FROM wishlist_blocks`
        const blockRows = parsed.blocks.map((b, id) => ({
          id,
          notes: b.notes,
          tags: JSON.stringify(b.tags),
          section_title: b.sectionTitle,
          section_description: b.sectionDescription,
          section_url: b.sectionUrl,
          section_date: b.sectionDate,
        }))
        for (let i = 0; i < blockRows.length; i += BATCH) {
          yield* sql`INSERT INTO wishlist_blocks ${sql.insert(blockRows.slice(i, i + BATCH))}`
        }
        const rollRows = parsed.rolls.map((r, position) => ({
          position,
          item_hash: r.itemHash,
          perk_hashes: JSON.stringify(r.perkHashes),
          trash: r.trash ? 1 : 0,
          block_id: r.block,
        }))
        for (let i = 0; i < rollRows.length; i += BATCH) {
          yield* sql`INSERT INTO wishlist_rolls ${sql.insert(rollRows.slice(i, i + BATCH))}`
        }
        blocks.clear()
        pairs = null
        return parsed.rolls.length
      }).pipe(sql.withTransaction, Effect.orDie)

    const populated = sql<{ count: number }>`SELECT COUNT(*) AS count FROM wishlist_rolls`.pipe(
      Effect.orDie,
      Effect.map((rows) => (rows[0]?.count ?? 0) > 0),
    )

    const refresh = Effect.gen(function* () {
      // With nothing stored, a 304 would leave the tables empty for good, so
      // the ETag is only sent when there is a copy it describes.
      const etag = (yield* populated) ? yield* setting(KEYS.etag) : null
      const request = HttpClientRequest.get(WISHLIST_URL).pipe(
        etag === null ? (r) => r : HttpClientRequest.setHeader("If-None-Match", etag),
      )
      const response = yield* http.execute(request).pipe(Effect.mapError(fail))
      const now = DateTime.formatIso(yield* DateTime.now)
      if (response.status === 304) {
        yield* settings.set(KEYS.fetchedAt, now).pipe(Effect.orDie)
        return
      }
      if (response.status !== 200) {
        return yield* new WishlistError({ message: `wishlist download: HTTP ${response.status}` })
      }
      const text = yield* response.text.pipe(Effect.mapError(fail))
      const count = yield* store(text)
      const newTag = response.headers["etag"]
      if (newTag !== undefined) yield* settings.set(KEYS.etag, newTag).pipe(Effect.orDie)
      yield* settings.set(KEYS.fetchedAt, now).pipe(Effect.orDie)
      yield* settings.set(KEYS.changedAt, now).pipe(Effect.orDie)
      yield* Effect.logInfo(`wishlist: stored ${count} rolls`)
    }).pipe(
      // The lock is held for the whole download, so a hung one would stall
      // every judgment that reads rolls.
      Effect.timeoutOrElse({
        duration: DOWNLOAD_TIMEOUT,
        orElse: () => Effect.fail(new WishlistError({ message: "wishlist download timed out" })),
      }),
    )

    // A failed revalidation keeps serving the copy we have; only a missing
    // copy is an error.
    const ensure = Effect.gen(function* () {
      const fetchedAt = yield* setting(KEYS.fetchedAt)
      const now = yield* DateTime.now
      const fresh =
        fetchedAt !== null &&
        DateTime.toEpochMillis(now) - Date.parse(fetchedAt) < REFRESH_MS &&
        (yield* populated)
      if (fresh) return
      yield* refresh.pipe(
        Effect.catch((error) =>
          Effect.flatMap(populated, (has) =>
            has
              ? Effect.logWarning(`wishlist refresh failed, using stored copy: ${error.message}`)
              : Effect.fail(error),
          ),
        ),
      )
    }).pipe(lock.withPermits(1))

    const blockOf = (row: JoinedRow): WishlistBlock => {
      const known = blocks.get(row.block_id)
      if (known !== undefined) return known
      const block: WishlistBlock = {
        notes: row.notes,
        tags: decodeTags(row.tags),
        sectionTitle: row.section_title,
        sectionDescription: row.section_description,
        sectionUrl: row.section_url,
        sectionDate: row.section_date,
      }
      blocks.set(row.block_id, block)
      return block
    }

    const rollsFor = (itemHashes: Iterable<number>) =>
      Effect.gen(function* () {
        yield* ensure
        const wanted = [...new Set(itemHashes), WILDCARD_ITEM]
        const rows = yield* sql<JoinedRow>`
          SELECT r.item_hash, r.perk_hashes, r.trash, r.block_id, b.notes, b.tags,
                 b.section_title, b.section_description, b.section_url, b.section_date
          FROM wishlist_rolls r JOIN wishlist_blocks b ON b.id = r.block_id
          WHERE r.item_hash IN ${sql.in(wanted)}
          ORDER BY r.position
        `.pipe(Effect.orDie)
        const all = rows.map((row): StoredRoll => ({
          itemHash: row.item_hash,
          perkHashes: decodePerkHashes(row.perk_hashes),
          trash: row.trash === 1,
          block: blockOf(row),
        }))
        const wildcard = all.filter((r) => r.itemHash === WILDCARD_ITEM)
        const result = new Map<number, ReadonlyArray<StoredRoll>>()
        for (const hash of wanted) {
          if (hash === WILDCARD_ITEM) continue
          result.set(hash, [...all.filter((r) => r.itemHash === hash), ...wildcard])
        }
        return result
      })

    const recommended = Effect.gen(function* () {
      yield* ensure
      if (pairs !== null) return pairs
      const rows = yield* sql<{ item_hash: number; perk_hash: number }>`
        SELECT DISTINCT r.item_hash, j.value AS perk_hash
        FROM wishlist_rolls r, json_each(r.perk_hashes) j
        WHERE r.trash = 0 AND r.item_hash != ${WILDCARD_ITEM}
      `.pipe(Effect.orDie)
      pairs = rows.map((row) => ({ itemHash: row.item_hash, perkHash: row.perk_hash }))
      return pairs
    })

    const asOf = setting(KEYS.changedAt)

    return {
      ensure,
      rollsFor,
      recommended,
      asOf,
      source: Effect.map(
        asOf,
        (at) =>
          new Source({ label: "DIM community wishlist (voltron)", url: WISHLIST_URL, asOf: at }),
      ),
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
