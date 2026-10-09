import { Context, Effect, Layer, Option } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

export interface SettingsService {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>, SqlError.SqlError>
  readonly set: (key: string, value: string) => Effect.Effect<void, SqlError.SqlError>
  readonly remove: (key: string) => Effect.Effect<void, SqlError.SqlError>
}

// A tiny key/value table for things that are set once and read often, such as
// the Bungie OAuth tokens and the chosen membership id.
export class Settings extends Context.Service<Settings, SettingsService>()('Settings') {}

export const SettingsLive = Layer.effect(
  Settings,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return {
      get: (key) =>
        sql<{ value: string }>`SELECT value FROM settings WHERE key = ${key}`.pipe(
          Effect.map((rows) => Option.fromNullishOr(rows[0]?.value)),
        ),
      set: (key, value) =>
        sql`
          INSERT INTO settings (key, value) VALUES (${key}, ${value})
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `.pipe(Effect.asVoid),
      remove: (key) => sql`DELETE FROM settings WHERE key = ${key}`.pipe(Effect.asVoid),
    }
  }),
)
