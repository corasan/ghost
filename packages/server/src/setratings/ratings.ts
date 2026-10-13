import { Source } from '@ghost/contract'
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { Settings } from '../db/settings.ts'
import { parseSetRatings, ratingKey, type SetBonusRating } from './parse.ts'

// Which armor sets are worth chasing comes from Aegis's Endgame Analysis
// sheet, not the model's memory or a web search. Its Set Bonuses tab is
// public, so the CSV export needs no sign-in; the raw text is kept in
// Settings and re-downloaded at most once a week, because it changes rarely.

const SHEET = '1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY'
const TAB = '1665223292'
export const SET_RATINGS_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=${TAB}`
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${TAB}`
export const SET_RATINGS_LABEL = 'Destiny 2: Endgame Analysis (Aegis), Set Bonuses'
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000
const DOWNLOAD_TIMEOUT = '30 seconds'

const KEYS = {
  csv: 'setRatings.csv',
  fetchedAt: 'setRatings.fetchedAt',
} as const

class SetRatingsError extends Schema.TaggedError<SetRatingsError>()('SetRatingsError', {
  message: Schema.String,
}) {}

export interface SetRatingsSnapshot {
  /** Keyed by ratingKey of the bonus name, which is unique across the sheet. */
  readonly byBonus: ReadonlyMap<string, SetBonusRating>
  /** When the stored copy was downloaded; null when there is none. */
  readonly asOf: string | null
  /** Why there are no ratings; null whenever a copy is stored. */
  readonly error: string | null
}

export interface SetRatingsService {
  /** Downloads when the stored copy is older than a week; never fails. */
  readonly ratings: Effect.Effect<SetRatingsSnapshot>
  /** Citation for the sheet. */
  readonly source: Effect.Effect<Source>
}

export class SetRatings extends Context.Service<SetRatings, SetRatingsService>()('SetRatings') {}

const indexed = (rows: ReadonlyArray<SetBonusRating>) =>
  new Map(rows.map((row) => [ratingKey(row.bonus), row]))

const parse = (text: string) =>
  Effect.try({
    try: () => parseSetRatings(text),
    catch: (cause) =>
      new SetRatingsError({ message: cause instanceof Error ? cause.message : String(cause) }),
  })

export const SetRatingsLive = Layer.effect(
  SetRatings,
  Effect.gen(function* () {
    const settings = yield* Settings
    const http = yield* HttpClient.HttpClient
    const lock = yield* Semaphore.make(1)
    let parsed: { readonly text: string; readonly byBonus: SetRatingsSnapshot['byBonus'] } | null =
      null

    const fail = (cause: unknown) => new SetRatingsError({ message: String(cause) })
    const setting = (key: string) =>
      settings.get(key).pipe(Effect.orDie, Effect.map(Option.getOrNull))

    // Only a download that parses into ratings is stored, so a sign-in page
    // or a reshaped sheet never replaces a good copy.
    const refresh = Effect.gen(function* () {
      const response = yield* http
        .execute(HttpClientRequest.get(EXPORT_URL))
        .pipe(Effect.mapError(fail))
      if (response.status !== 200) {
        return yield* new SetRatingsError({
          message: `set ratings download: HTTP ${response.status}`,
        })
      }
      const text = yield* response.text.pipe(Effect.mapError(fail))
      const rows = yield* parse(text)
      if (rows.length === 0) {
        return yield* new SetRatingsError({ message: 'set ratings sheet has no rated bonuses' })
      }
      yield* settings.set(KEYS.csv, text).pipe(Effect.orDie)
      yield* settings
        .set(KEYS.fetchedAt, DateTime.formatIso(yield* DateTime.now))
        .pipe(Effect.orDie)
      parsed = { text, byBonus: indexed(rows) }
      yield* Effect.logInfo(`set ratings: stored ${rows.length} bonuses`)
    }).pipe(
      Effect.timeoutOrElse({
        duration: DOWNLOAD_TIMEOUT,
        orElse: () =>
          Effect.fail(new SetRatingsError({ message: 'set ratings download timed out' })),
      }),
    )

    // A failed refresh keeps serving the stored copy; only a missing copy
    // is reported.
    const ensure = Effect.gen(function* () {
      const fetchedAt = yield* setting(KEYS.fetchedAt)
      const stored = (yield* setting(KEYS.csv)) !== null
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      if (stored && fetchedAt !== null && now - Date.parse(fetchedAt) < REFRESH_MS) return
      yield* refresh.pipe(
        Effect.catch((error) =>
          stored
            ? Effect.logWarning(`set ratings refresh failed, using stored copy: ${error.message}`)
            : Effect.fail(error),
        ),
      )
    }).pipe(lock.withPermits(1))

    const byBonusOf = (text: string) =>
      Effect.gen(function* () {
        if (parsed?.text === text) return parsed.byBonus
        const byBonus = indexed(yield* parse(text))
        parsed = { text, byBonus }
        return byBonus
      })

    const ratings = Effect.gen(function* () {
      const error = yield* ensure.pipe(
        Effect.as(null),
        Effect.catch((e) => Effect.succeed(e.message)),
      )
      const text = yield* setting(KEYS.csv)
      if (text === null) {
        return { byBonus: new Map(), asOf: null, error: error ?? 'no copy of the sheet' }
      }
      return yield* byBonusOf(text).pipe(
        Effect.flatMap((byBonus) =>
          Effect.map(setting(KEYS.fetchedAt), (asOf) => ({ byBonus, asOf, error: null })),
        ),
        Effect.catch((e) => Effect.succeed({ byBonus: new Map(), asOf: null, error: e.message })),
      )
    })

    return {
      ratings,
      source: Effect.map(
        setting(KEYS.fetchedAt),
        (asOf) => new Source({ label: SET_RATINGS_LABEL, url: SET_RATINGS_URL, asOf }),
      ),
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
