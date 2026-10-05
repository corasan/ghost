import { type CreateJob, Job, JobNotFound, type JobStatus, Plan, Source } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

interface JobRow {
  readonly id: string
  readonly kind: string
  readonly prompt: string
  readonly status: string
  readonly result: string | null
  readonly error: string | null
  readonly plan: string | null
  readonly sources: string
  readonly character_id: string | null
  readonly created_at: string
  readonly updated_at: string
}

// Rows come back as untyped objects from SQLite; decoding through the Job
// schema at this boundary means everything above the repository works with
// a validated Job and never touches snake_case columns. The plan column is
// the contract Plan as JSON (sources likewise), so it decodes with the same schema.
const PlanJson = Schema.fromJsonString(Plan)
const SourcesJson = Schema.fromJsonString(Schema.Array(Source))
const encodePlan = Schema.encodeEffect(PlanJson)
const encodeSources = Schema.encodeEffect(SourcesJson)
const decodeRow = Schema.decodeUnknownEffect(
  Schema.Struct({ ...Job.fields, plan: Schema.NullOr(PlanJson), sources: SourcesJson }),
)
const rowToJob = (row: JobRow) =>
  decodeRow({
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    result: row.result,
    error: row.error,
    plan: row.plan,
    sources: row.sources,
    characterId: row.character_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }).pipe(
    Effect.map((fields) => new Job(fields)),
    Effect.orDie,
  )

export interface JobsRepoShape {
  readonly list: Effect.Effect<ReadonlyArray<Job>, SqlError.SqlError>
  readonly get: (id: string) => Effect.Effect<Job, JobNotFound | SqlError.SqlError>
  readonly create: (input: CreateJob) => Effect.Effect<Job, SqlError.SqlError>
  readonly setStatus: (
    id: string,
    status: JobStatus,
    patch?: { readonly result?: string; readonly error?: string },
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly setPlan: (id: string, plan: Plan) => Effect.Effect<void, SqlError.SqlError>
  /** Merged into what the job already cites; the same url (or label) is kept once. */
  readonly addSources: (
    id: string,
    sources: ReadonlyArray<Source>,
  ) => Effect.Effect<void, JobNotFound | SqlError.SqlError>
  readonly nextQueued: Effect.Effect<Option.Option<Job>, SqlError.SqlError>
}

export class JobsRepo extends Context.Service<JobsRepo, JobsRepoShape>()("JobsRepo") {}

export const JobsRepoLive = Layer.effect(
  JobsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const list = sql<JobRow>`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100`.pipe(
      Effect.flatMap(Effect.forEach(rowToJob)),
    )

    const get = (id: string) =>
      sql<JobRow>`SELECT * FROM jobs WHERE id = ${id}`.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? new JobNotFound({ id }) : rowToJob(rows[0]),
        ),
      )

    const create = (input: CreateJob) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID()
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO jobs (id, kind, prompt, status, result, error, character_id, created_at, updated_at)
          VALUES (${id}, ${input.kind}, ${input.prompt}, 'queued', NULL, NULL, ${input.characterId ?? null}, ${now}, ${now})
        `
        return yield* get(id).pipe(Effect.orDie)
      })

    const setStatus: JobsRepoShape["setStatus"] = (id, status, patch) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          UPDATE jobs
          SET status = ${status},
              result = COALESCE(${patch?.result ?? null}, result),
              error = COALESCE(${patch?.error ?? null}, error),
              updated_at = ${now}
          WHERE id = ${id}
        `
      })

    const setPlan = (id: string, plan: Plan) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        const json = yield* encodePlan(plan).pipe(Effect.orDie)
        yield* sql`UPDATE jobs SET plan = ${json}, updated_at = ${now} WHERE id = ${id}`
      })

    const addSources = (id: string, sources: ReadonlyArray<Source>) =>
      Effect.gen(function* () {
        const job = yield* get(id)
        const merged = new Map<string, Source>()
        for (const source of [...job.sources, ...sources]) {
          merged.set(source.url ?? source.label, source)
        }
        const json = yield* encodeSources([...merged.values()]).pipe(Effect.orDie)
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE jobs SET sources = ${json}, updated_at = ${now} WHERE id = ${id}`
      })

    const nextQueued = sql<JobRow>`
      SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined ? Effect.succeedNone : Effect.map(rowToJob(rows[0]), Option.some),
      ),
    )

    return { list, get, create, setStatus, setPlan, addSources, nextQueued }
  }),
)
