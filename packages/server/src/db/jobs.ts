import {
  ChatSession,
  type CreateJob,
  Job,
  JobNotFound,
  type JobKind,
  type JobOffer,
  JobStep,
  type JobStatus,
  Plan,
  Source,
} from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import { BuildRecipe } from "../plans/recipe.ts"

interface JobRow {
  readonly id: string
  readonly session_id: string | null
  readonly kind: string
  readonly prompt: string
  readonly status: string
  readonly result: string | null
  readonly error: string | null
  readonly plan: string | null
  readonly sources: string
  readonly steps: string
  readonly character_id: string | null
  readonly offer: string | null
  readonly created_at: string
  readonly updated_at: string
}

// Rows come back as untyped objects from SQLite; decoding through the Job
// schema at this boundary means everything above the repository works with
// a validated Job and never touches snake_case columns. The plan column is
// the contract Plan as JSON (sources likewise), so it decodes with the same schema.
const PlanJson = Schema.fromJsonString(Plan)
const SourcesJson = Schema.fromJsonString(Schema.Array(Source))
const StepsJson = Schema.fromJsonString(Schema.Array(JobStep))
const StepJson = Schema.fromJsonString(JobStep)
const encodePlan = Schema.encodeEffect(PlanJson)
const encodeSources = Schema.encodeEffect(SourcesJson)
const encodeStep = Schema.encodeEffect(StepJson)
const RecipeJson = Schema.fromJsonString(BuildRecipe)
const encodeRecipe = Schema.encodeEffect(RecipeJson)
const decodeRecipe = Schema.decodeUnknownEffect(RecipeJson)
const decodeRow = Schema.decodeUnknownEffect(
  Schema.Struct({
    ...Job.fields,
    plan: Schema.NullOr(PlanJson),
    sources: SourcesJson,
    steps: StepsJson,
  }),
)
const rowToJob = (row: JobRow) =>
  decodeRow({
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    result: row.result,
    error: row.error,
    plan: row.plan,
    sources: row.sources,
    steps: row.steps,
    characterId: row.character_id,
    offer: row.offer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }).pipe(
    Effect.map((fields) => new Job(fields)),
    Effect.orDie,
  )

interface SessionRow {
  readonly id: string
  readonly title: string
  readonly started_at: string
  readonly last_at: string
  readonly count: number
}

export interface ManualJob {
  readonly kind: Extract<JobKind, "item_action" | "saved_build">
  readonly prompt: string
  readonly characterId: string | null
  readonly plan: Plan
}

export interface JobsRepoService {
  readonly list: Effect.Effect<ReadonlyArray<Job>, SqlError.SqlError>
  readonly inSession: (sessionId: string) => Effect.Effect<ReadonlyArray<Job>, SqlError.SqlError>
  readonly sessions: Effect.Effect<ReadonlyArray<ChatSession>, SqlError.SqlError>
  readonly get: (id: string) => Effect.Effect<Job, JobNotFound | SqlError.SqlError>
  readonly create: (input: CreateJob) => Effect.Effect<Job, SqlError.SqlError>
  /** A finished job outside any conversation, holding a plan the player asked for directly. */
  readonly createManual: (input: ManualJob) => Effect.Effect<Job, SqlError.SqlError>
  readonly addStep: (id: string, step: JobStep) => Effect.Effect<void, SqlError.SqlError>
  readonly setStatus: (
    id: string,
    status: JobStatus,
    patch?: { readonly result?: string; readonly error?: string },
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly setPlan: (id: string, plan: Plan) => Effect.Effect<void, SqlError.SqlError>
  readonly setOffer: (id: string, offer: JobOffer) => Effect.Effect<void, SqlError.SqlError>
  readonly setRecipe: (id: string, recipe: BuildRecipe) => Effect.Effect<void, SqlError.SqlError>
  readonly recipe: (id: string) => Effect.Effect<Option.Option<BuildRecipe>, SqlError.SqlError>
  /** Merged into what the job already cites; the same url (or label) is kept once. */
  readonly addSources: (
    id: string,
    sources: ReadonlyArray<Source>,
  ) => Effect.Effect<void, JobNotFound | SqlError.SqlError>
  readonly nextQueued: Effect.Effect<Option.Option<Job>, SqlError.SqlError>
  /** Fails every job still marked running; only a restart mid-answer leaves one behind. */
  readonly failInterrupted: Effect.Effect<void, SqlError.SqlError>
}

export class JobsRepo extends Context.Service<JobsRepo, JobsRepoService>()("JobsRepo") {}

export const JobsRepoLive = Layer.effect(
  JobsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const list = sql<JobRow>`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100`.pipe(
      Effect.flatMap(Effect.forEach(rowToJob)),
    )

    const inSession = (sessionId: string) =>
      sql<JobRow>`
        SELECT * FROM jobs WHERE session_id = ${sessionId} ORDER BY created_at DESC LIMIT 200
      `.pipe(Effect.flatMap(Effect.forEach(rowToJob)))

    const sessions = sql<SessionRow>`
      SELECT session_id AS id,
             (SELECT prompt FROM jobs first
              WHERE first.session_id = jobs.session_id
              ORDER BY created_at ASC LIMIT 1) AS title,
             MIN(created_at) AS started_at,
             MAX(created_at) AS last_at,
             COUNT(*) AS count
      FROM jobs
      WHERE session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY last_at DESC
      LIMIT 50
    `.pipe(
      Effect.map((rows) =>
        rows.map(
          (row) =>
            new ChatSession({
              id: row.id,
              title: row.title,
              startedAt: row.started_at,
              lastAt: row.last_at,
              count: row.count,
            }),
        ),
      ),
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
          INSERT INTO jobs (id, session_id, kind, prompt, status, result, error, character_id, created_at, updated_at)
          VALUES (${id}, ${input.sessionId ?? crypto.randomUUID()}, ${input.kind}, ${input.prompt}, 'queued', NULL, NULL, ${input.characterId ?? null}, ${now}, ${now})
        `
        return yield* get(id).pipe(Effect.orDie)
      })

    const createManual = (input: ManualJob) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID()
        const now = DateTime.formatIso(yield* DateTime.now)
        const plan = yield* encodePlan(input.plan).pipe(Effect.orDie)
        yield* sql`
          INSERT INTO jobs (id, session_id, kind, prompt, status, result, error, plan, character_id, created_at, updated_at)
          VALUES (${id}, NULL, ${input.kind}, ${input.prompt}, 'done', NULL, NULL, ${plan}, ${input.characterId}, ${now}, ${now})
        `
        return yield* get(id).pipe(Effect.orDie)
      })

    const addStep = (id: string, step: JobStep) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        const json = yield* encodeStep(step).pipe(Effect.orDie)
        yield* sql`
          UPDATE jobs
          SET steps = json_insert(steps, '$[#]', json(${json})), updated_at = ${now}
          WHERE id = ${id}
        `
      })

    const setStatus: JobsRepoService["setStatus"] = (id, status, patch) =>
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

    const setOffer = (id: string, offer: JobOffer) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE jobs SET offer = ${offer}, updated_at = ${now} WHERE id = ${id}`
      })

    const setRecipe = (id: string, recipe: BuildRecipe) =>
      Effect.gen(function* () {
        const json = yield* encodeRecipe(recipe).pipe(Effect.orDie)
        yield* sql`UPDATE jobs SET recipe = ${json} WHERE id = ${id}`
      })

    const recipe = (id: string) =>
      sql<{ readonly recipe: string | null }>`SELECT recipe FROM jobs WHERE id = ${id}`.pipe(
        Effect.flatMap((rows) => {
          const json = rows[0]?.recipe
          return json === undefined || json === null
            ? Effect.succeedNone
            : decodeRecipe(json).pipe(Effect.map(Option.some), Effect.orDie)
        }),
      )

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

    const failInterrupted = Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now)
      yield* sql`
        UPDATE jobs
        SET status = 'failed',
            error = 'The server restarted before I finished. Ask again.',
            updated_at = ${now}
        WHERE status = 'running'
      `
    })

    return {
      failInterrupted,
      list,
      inSession,
      sessions,
      get,
      create,
      createManual,
      addStep,
      setStatus,
      setPlan,
      setOffer,
      setRecipe,
      recipe,
      addSources,
      nextQueued,
    }
  }),
)
