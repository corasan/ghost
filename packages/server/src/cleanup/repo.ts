import { CleanupNotFound, CleanupSession } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

const SessionJson = Schema.fromJsonString(CleanupSession)
const encode = Schema.encodeEffect(SessionJson)
const decode = Schema.decodeUnknownEffect(SessionJson)

const fromRow = (row: { readonly state: string }) =>
  decode(row.state).pipe(
    Effect.map((fields) => new CleanupSession(fields)),
    Effect.orDie,
  )

export interface CleanupRepoService {
  readonly save: (session: CleanupSession) => Effect.Effect<void, SqlError.SqlError>
  readonly get: (id: string) => Effect.Effect<CleanupSession, CleanupNotFound | SqlError.SqlError>
  readonly active: Effect.Effect<Option.Option<CleanupSession>, SqlError.SqlError>
}

export class CleanupRepo extends Context.Service<CleanupRepo, CleanupRepoService>()(
  "CleanupRepo",
) {}

export const CleanupRepoLive = Layer.effect(
  CleanupRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const save = (session: CleanupSession) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        const state = yield* encode(session).pipe(Effect.orDie)
        yield* sql`
          INSERT INTO cleanup_sessions (id, stage, state, created_at, updated_at)
          VALUES (${session.id}, ${session.stage}, ${state}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET stage = excluded.stage, state = excluded.state,
            updated_at = excluded.updated_at
        `
      })

    const get = (id: string) =>
      sql<{ state: string }>`SELECT state FROM cleanup_sessions WHERE id = ${id}`.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? new CleanupNotFound({ id }) : fromRow(rows[0]),
        ),
      )

    const active = sql<{ state: string }>`
      SELECT state FROM cleanup_sessions WHERE stage NOT IN ('stopped', 'closed')
      ORDER BY created_at DESC LIMIT 1
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined ? Effect.succeedNone : Effect.map(fromRow(rows[0]), Option.some),
      ),
    )

    return { save, get, active }
  }),
)
