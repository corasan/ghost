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
  "0007_charge_effects": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS charge_effects (
        mod TEXT PRIMARY KEY,
        effect TEXT NOT NULL,
        source_label TEXT NOT NULL,
        source_url TEXT,
        source_as_of TEXT,
        recorded_at TEXT NOT NULL
      )
    `
  }),
  "0008_saved_builds": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE jobs ADD COLUMN recipe TEXT`
    yield* sql`
      CREATE TABLE IF NOT EXISTS saved_builds (
        id TEXT PRIMARY KEY,
        job_id TEXT UNIQUE,
        name TEXT NOT NULL,
        recipe TEXT NOT NULL,
        plan TEXT NOT NULL,
        in_game_character_id TEXT,
        in_game_index INTEGER,
        in_game_saved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS saved_builds_in_game
      ON saved_builds (in_game_character_id, in_game_index)
    `
  }),
  // A cleanup session is one JSON document; stage is its own column so the
  // active session is found without decoding every past one.
  "0009_cleanup_sessions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS cleanup_sessions (
        id TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
  }),
  "0010_job_offer": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE jobs ADD COLUMN offer TEXT`
  }),
  // Jev's answer to one question, keyed by a hash of the model, subject,
  // request and item text, so judging the same vault twice gives the same
  // verdicts and asks Jev nothing the second time.
  "0011_jev_answers": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS jev_answers (
        key TEXT PRIMARY KEY,
        answer REAL NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  }),
  // How good each trait perk is on one weapon, as the player or Claude rated
  // it. Junk judging stopped asking Jev, so its answers go.
  "0012_perk_ratings": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS perk_ratings (
        item_hash INTEGER NOT NULL,
        perk TEXT NOT NULL,
        source TEXT NOT NULL,
        rating TEXT NOT NULL,
        note TEXT,
        url TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (item_hash, perk, source)
      )
    `
    yield* sql`DROP TABLE IF EXISTS jev_answers`
  }),
  // Ratings follow the weapon's name, since reissues get new item hashes and
  // the player and Claude both name weapons, not hashes.
  "0013_perk_ratings_by_weapon": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DROP TABLE IF EXISTS perk_ratings`
    yield* sql`
      CREATE TABLE perk_ratings (
        weapon TEXT NOT NULL,
        perk TEXT NOT NULL,
        source TEXT NOT NULL,
        rating TEXT NOT NULL,
        note TEXT,
        url TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (weapon, perk, source)
      )
    `
  }),
  // A perk can be good for PvE and not for PvP, so a rating names its purpose.
  "0014_perk_rating_purpose": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE perk_ratings_next (
        weapon TEXT NOT NULL,
        perk TEXT NOT NULL,
        source TEXT NOT NULL,
        purpose TEXT NOT NULL,
        rating TEXT NOT NULL,
        note TEXT,
        url TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (weapon, perk, source, purpose)
      )
    `
    yield* sql`
      INSERT INTO perk_ratings_next
      SELECT weapon, perk, source, 'any', rating, note, url, updated_at FROM perk_ratings
    `
    yield* sql`DROP TABLE perk_ratings`
    yield* sql`ALTER TABLE perk_ratings_next RENAME TO perk_ratings`
  }),
  // Undoing a junk tag puts back the decision the item had before.
  "0015_action_previous_decision": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE actions ADD COLUMN previous_decision TEXT`
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
