import { mkdirSync } from "node:fs"
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
  // "source" is who put the item in front of you (postmaster, drop, vendor,
  // unknown) and "decision" is what you told Ghost to do about it. The
  // manifest table is a local cache of Bungie's item definitions so names and
  // tiers resolve without a network call per item.
  "0002_decisions_and_manifest": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE items_seen ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'`
    yield* sql`ALTER TABLE items_seen ADD COLUMN decision TEXT`
    yield* sql`
      CREATE TABLE IF NOT EXISTS manifest_items (
        hash INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        type_name TEXT NOT NULL,
        icon TEXT,
        tier_type INTEGER NOT NULL,
        bucket_hash INTEGER NOT NULL,
        item_type INTEGER NOT NULL,
        damage_type INTEGER NOT NULL
      )
    `
  }),
  // Plans are what the agent proposes; actions journal every call the server
  // made after the player confirmed, so a request can be shown and undone.
  // Baseline rows were already owned on the very first sync, so they are not
  // "new". The manifest gains class_type and descriptions, so stored copies
  // are re-downloaded. wishlist_rolls is the community roll list the agent
  // judges rolls against, and jobs keep the sources an answer relied on.
  "0003_plans_sync_actions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE jobs ADD COLUMN plan TEXT`
    yield* sql`ALTER TABLE jobs ADD COLUMN character_id TEXT`
    yield* sql`ALTER TABLE jobs ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'`
    yield* sql`ALTER TABLE items_seen ADD COLUMN baseline INTEGER NOT NULL DEFAULT 0`
    yield* sql`ALTER TABLE items_seen ADD COLUMN job_id TEXT`
    yield* sql`
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        item_instance_id TEXT NOT NULL,
        item_hash INTEGER,
        name TEXT,
        kind TEXT NOT NULL,
        character_id TEXT,
        from_location TEXT,
        from_character_id TEXT,
        previous_item_id TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS actions_job ON actions (job_id)`
    yield* sql`CREATE INDEX IF NOT EXISTS items_seen_first_seen ON items_seen (first_seen_at)`
    yield* sql`ALTER TABLE manifest_items ADD COLUMN class_type INTEGER NOT NULL DEFAULT 3`
    yield* sql`ALTER TABLE manifest_items ADD COLUMN description TEXT`
    // Notes are shared by hundreds of roll lines, so they live once per block.
    yield* sql`
      CREATE TABLE IF NOT EXISTS wishlist_blocks (
        id INTEGER PRIMARY KEY,
        notes TEXT,
        tags TEXT NOT NULL,
        section_title TEXT,
        section_description TEXT,
        section_url TEXT,
        section_date TEXT
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS wishlist_rolls (
        position INTEGER PRIMARY KEY,
        item_hash INTEGER NOT NULL,
        perk_hashes TEXT NOT NULL,
        trash INTEGER NOT NULL,
        block_id INTEGER NOT NULL
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS wishlist_rolls_item ON wishlist_rolls (item_hash)`
    yield* sql`DELETE FROM settings WHERE key = 'manifest.version'`
  }),
  // Creator notes: dated, timestamped claims summarized from YouTube videos.
  // A video row is kept even when it yields no notes, so it is summarized once.
  "0004_creator_notes": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS creator_channels (
        ref TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        error TEXT
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS creator_videos (
        video_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        channel_title TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TEXT NOT NULL,
        basis TEXT NOT NULL,
        status TEXT NOT NULL,
        processed_at TEXT NOT NULL
      )
    `
    yield* sql`
      CREATE TABLE IF NOT EXISTS creator_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        claim TEXT NOT NULL,
        start_sec INTEGER,
        names TEXT NOT NULL,
        unverified TEXT NOT NULL
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS creator_notes_video ON creator_notes (video_id)`
  }),
  "0005_sessions_and_steps": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE jobs ADD COLUMN session_id TEXT`
    yield* sql`ALTER TABLE jobs ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'`
    yield* sql`UPDATE jobs SET session_id = 'first'`
    yield* sql`CREATE INDEX IF NOT EXISTS jobs_session ON jobs (session_id, created_at)`
  }),
  "0006_mod_actions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE actions ADD COLUMN socket_index INTEGER`
    yield* sql`ALTER TABLE actions ADD COLUMN plug_hash INTEGER`
    yield* sql`ALTER TABLE actions ADD COLUMN previous_plug_hash INTEGER`
  }),
}

const SqliteLive = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDir } = yield* AppConfig
    // The data directory is gitignored, so a fresh clone does not have it and
    // SQLite refuses to create a file inside a missing folder.
    yield* Effect.sync(() => mkdirSync(dataDir, { recursive: true }))
    return SqliteClient.layer({ filename: `${dataDir}/ghost.sqlite`, create: true })
  }),
).pipe(Layer.provide(Reactivity.layer))

const MigrationsLive = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })

export const DatabaseLive = MigrationsLive.pipe(Layer.provideMerge(SqliteLive))
