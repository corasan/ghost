import type { ActionStatus } from "@ghost/contract"
import { Context, DateTime, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

// One row per Bungie call the server made for a confirmed plan (plus a
// "held" row for each item the player unticked). It is the source of truth
// for history and for undo, which replays the ok rows backwards.

export type ActionKind =
  | "to_vault"
  | "to_character"
  | "pull_postmaster"
  | "equip"
  | "tag_junk"
  | "insert_mod"
  | "insert_subclass_plug"
  | "held"

export interface ActionRecord {
  readonly id: string
  readonly jobId: string
  readonly itemInstanceId: string
  readonly itemHash: number | null
  readonly name: string | null
  readonly kind: ActionKind
  /** Where the item went (to_character, equip) or whose postmaster it left. */
  readonly characterId: string | null
  readonly fromLocation: string | null
  readonly fromCharacterId: string | null
  /** The item or subclass an equip replaced, so undo can put it back on. */
  readonly previousItemId: string | null
  /** For insert_mod and insert_subclass_plug: the socket, the plug put in, and the plug it displaced so undo can restore it. */
  readonly socketIndex?: number | null
  readonly plugHash?: number | null
  readonly previousPlugHash?: number | null
  readonly status: ActionStatus
  readonly error: string | null
  readonly createdAt: string
}

export type NewAction = Omit<ActionRecord, "id" | "createdAt">

interface ActionRow {
  readonly id: string
  readonly job_id: string
  readonly item_instance_id: string
  readonly item_hash: number | null
  readonly name: string | null
  readonly kind: ActionKind
  readonly character_id: string | null
  readonly from_location: string | null
  readonly from_character_id: string | null
  readonly previous_item_id: string | null
  readonly socket_index: number | null
  readonly plug_hash: number | null
  readonly previous_plug_hash: number | null
  readonly status: ActionStatus
  readonly error: string | null
  readonly created_at: string
}

const fromRow = (row: ActionRow): ActionRecord => ({
  id: row.id,
  jobId: row.job_id,
  itemInstanceId: row.item_instance_id,
  itemHash: row.item_hash,
  name: row.name,
  kind: row.kind,
  characterId: row.character_id,
  fromLocation: row.from_location,
  fromCharacterId: row.from_character_id,
  previousItemId: row.previous_item_id,
  socketIndex: row.socket_index,
  plugHash: row.plug_hash,
  previousPlugHash: row.previous_plug_hash,
  status: row.status,
  error: row.error,
  createdAt: row.created_at,
})

export interface ActionsRepoService {
  readonly record: (action: NewAction) => Effect.Effect<void, SqlError.SqlError>
  /** In the order they were made. */
  readonly forJobs: (
    jobIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ActionRecord>, SqlError.SqlError>
  readonly setStatus: (id: string, status: ActionStatus) => Effect.Effect<void, SqlError.SqlError>
  readonly countOkSince: (since: string) => Effect.Effect<number, SqlError.SqlError>
}

export class ActionsRepo extends Context.Service<ActionsRepo, ActionsRepoService>()(
  "ActionsRepo",
) {}

export const ActionsRepoLive = Layer.effect(
  ActionsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const record = (action: NewAction) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO actions ${sql.insert({
            id: crypto.randomUUID(),
            job_id: action.jobId,
            item_instance_id: action.itemInstanceId,
            item_hash: action.itemHash,
            name: action.name,
            kind: action.kind,
            character_id: action.characterId,
            from_location: action.fromLocation,
            from_character_id: action.fromCharacterId,
            previous_item_id: action.previousItemId,
            socket_index: action.socketIndex ?? null,
            plug_hash: action.plugHash ?? null,
            previous_plug_hash: action.previousPlugHash ?? null,
            status: action.status,
            error: action.error,
            created_at: now,
          })}
        `
      })

    // rowid keeps insertion order even when two calls share a timestamp.
    const forJobs = (jobIds: ReadonlyArray<string>) =>
      jobIds.length === 0
        ? Effect.succeed([])
        : sql<ActionRow>`
            SELECT * FROM actions WHERE ${sql.in("job_id", jobIds)} ORDER BY rowid ASC
          `.pipe(Effect.map((rows) => rows.map(fromRow)))

    const setStatus = (id: string, status: ActionStatus) =>
      sql`UPDATE actions SET status = ${status} WHERE id = ${id}`.pipe(Effect.asVoid)

    const countOkSince = (since: string) =>
      sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM actions WHERE status = 'ok' AND created_at >= ${since}
      `.pipe(Effect.map((rows) => rows[0]?.count ?? 0))

    return { record, forJobs, setStatus, countOkSince }
  }),
)
