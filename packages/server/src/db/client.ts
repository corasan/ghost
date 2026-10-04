import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../config.ts"

// Migrations are plain SQL effects keyed by "<id>_<name>". The migrator keeps
// a table of applied ids, so restarting the server is safe: already-applied
// migrations are skipped. New schema changes get a new numbered entry.
const migrations = {
  "0001_init": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS items_seen (
        item_instance_id TEXT PRIMARY KEY,
        item_hash INTEGER NOT NULL,
        name TEXT,
        location TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `
  }),
}

const SqliteLive = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDir } = yield* AppConfig
    return SqliteClient.layer({ filename: `${dataDir}/ghost.sqlite`, create: true })
  }),
).pipe(Layer.provide(Reactivity.layer))

const MigrationsLive = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })

export const DatabaseLive = MigrationsLive.pipe(Layer.provideMerge(SqliteLive))
