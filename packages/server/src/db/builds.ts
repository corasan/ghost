import { BuildNotFound, InGameSlotRef, Plan } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, type SqlError } from "effect/sql"
import { BuildRecipe } from "../plans/recipe.ts"

interface BuildRow {
  readonly id: string
  readonly job_id: string | null
  readonly name: string
  readonly recipe: string
  readonly plan: string
  readonly in_game_character_id: string | null
  readonly in_game_index: number | null
  readonly in_game_saved_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface StoredBuild {
  readonly id: string
  readonly jobId: string | null
  readonly name: string
  readonly recipe: BuildRecipe
  readonly plan: Plan
  readonly inGame: InGameSlotRef | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NewBuild {
  readonly jobId: string
  readonly name: string
  readonly recipe: BuildRecipe
  readonly plan: Plan
}

const PlanJson = Schema.fromJsonString(Plan)
const RecipeJson = Schema.fromJsonString(BuildRecipe)
const encodePlan = Schema.encodeEffect(PlanJson)
const encodeRecipe = Schema.encodeEffect(RecipeJson)
const decodeStored = Schema.decodeUnknownEffect(
  Schema.Struct({
    id: Schema.String,
    jobId: Schema.NullOr(Schema.String),
    name: Schema.String,
    recipe: RecipeJson,
    plan: PlanJson,
    inGame: Schema.NullOr(InGameSlotRef),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)

const rowToBuild = (row: BuildRow): Effect.Effect<StoredBuild> =>
  decodeStored({
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    recipe: row.recipe,
    plan: row.plan,
    inGame:
      row.in_game_character_id === null ||
      row.in_game_index === null ||
      row.in_game_saved_at === null
        ? null
        : {
            characterId: row.in_game_character_id,
            index: row.in_game_index,
            savedAt: row.in_game_saved_at,
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }).pipe(Effect.orDie)

export interface BuildsRepoService {
  readonly list: Effect.Effect<ReadonlyArray<StoredBuild>, SqlError.SqlError>
  readonly get: (id: string) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
  readonly byJob: (jobId: string) => Effect.Effect<Option.Option<StoredBuild>, SqlError.SqlError>
  readonly insert: (input: NewBuild) => Effect.Effect<StoredBuild, SqlError.SqlError>
  readonly rename: (
    id: string,
    name: string,
  ) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
  readonly remove: (id: string) => Effect.Effect<void, BuildNotFound | SqlError.SqlError>
  readonly claimInGameSlot: (
    id: string,
    slot: Pick<InGameSlotRef, "characterId" | "index">,
  ) => Effect.Effect<void, BuildNotFound | SqlError.SqlError>
}

export class BuildsRepo extends Context.Service<BuildsRepo, BuildsRepoService>()("BuildsRepo") {}

export const BuildsRepoLive = Layer.effect(
  BuildsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const list = sql<BuildRow>`SELECT * FROM saved_builds ORDER BY created_at DESC`.pipe(
      Effect.flatMap(Effect.forEach(rowToBuild)),
    )

    const get = (id: string) =>
      sql<BuildRow>`SELECT * FROM saved_builds WHERE id = ${id}`.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? new BuildNotFound({ id }) : rowToBuild(rows[0]),
        ),
      )

    const byJob = (jobId: string) =>
      sql<BuildRow>`SELECT * FROM saved_builds WHERE job_id = ${jobId}`.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeedNone : Effect.map(rowToBuild(rows[0]), Option.some),
        ),
      )

    const insert = (input: NewBuild) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID()
        const now = DateTime.formatIso(yield* DateTime.now)
        const recipe = yield* encodeRecipe(input.recipe).pipe(Effect.orDie)
        const plan = yield* encodePlan(input.plan).pipe(Effect.orDie)
        yield* sql`
          INSERT INTO saved_builds (id, job_id, name, recipe, plan, created_at, updated_at)
          VALUES (${id}, ${input.jobId}, ${input.name}, ${recipe}, ${plan}, ${now}, ${now})
        `
        return yield* get(id).pipe(Effect.orDie)
      })

    const touched = (id: string, update: Effect.Effect<unknown, SqlError.SqlError>) =>
      Effect.gen(function* () {
        yield* get(id)
        yield* update
        return yield* get(id)
      })

    const rename = (id: string, name: string) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        return yield* touched(
          id,
          sql`UPDATE saved_builds SET name = ${name}, updated_at = ${now} WHERE id = ${id}`,
        )
      })

    const remove = (id: string) =>
      Effect.gen(function* () {
        yield* get(id)
        yield* sql`DELETE FROM saved_builds WHERE id = ${id}`
      })

    const claimInGameSlot = (id: string, slot: Pick<InGameSlotRef, "characterId" | "index">) =>
      Effect.gen(function* () {
        yield* get(id)
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          UPDATE saved_builds
          SET in_game_character_id = NULL, in_game_index = NULL, in_game_saved_at = NULL, updated_at = ${now}
          WHERE in_game_character_id = ${slot.characterId} AND in_game_index = ${slot.index} AND id <> ${id}
        `
        yield* sql`
          UPDATE saved_builds
          SET in_game_character_id = ${slot.characterId}, in_game_index = ${slot.index}, in_game_saved_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `
      }).pipe(sql.withTransaction)

    return { list, get, byJob, insert, rename, remove, claimInGameSlot }
  }),
)
