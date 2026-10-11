import { BuildNotFound, Plan } from '@ghost/contract'
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { SlotSnapshot } from '../bungie/loadouts.ts'
import { BuildRecipe } from '../plans/recipe.ts'

interface BuildRow {
  readonly id: string
  readonly job_id: string | null
  readonly name: string
  readonly recipe: string
  readonly plan: string
  readonly revision: number
  readonly in_game_character_id: string | null
  readonly in_game_index: number | null
  readonly in_game_saved_at: string | null
  readonly in_game_revision: number | null
  readonly in_game_snapshot: string | null
  readonly created_at: string
  readonly updated_at: string
}

/** The in-game slot a build is linked to, and where the two last agreed. */
export interface BuildLink {
  readonly characterId: string
  readonly index: number
  readonly savedAt: string
  /** The build's revision when the two last agreed. */
  readonly revision: number
  /** The slot's gear when the two last agreed; null until the slot is first seen holding the build. */
  readonly snapshot: SlotSnapshot | null
}

export interface StoredBuild {
  readonly id: string
  readonly jobId: string | null
  readonly name: string
  readonly recipe: BuildRecipe
  readonly plan: Plan
  /** Counts edits to the build's gear and purpose; a rename leaves it. */
  readonly revision: number
  readonly link: BuildLink | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface BuildContent {
  readonly name: string
  readonly recipe: BuildRecipe
  readonly plan: Plan
}

export interface NewBuild extends BuildContent {
  readonly jobId: string
}

export type SlotKey = Pick<BuildLink, 'characterId' | 'index'>

const PlanJson = Schema.fromJsonString(Plan)
const RecipeJson = Schema.fromJsonString(BuildRecipe)
const SnapshotJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ itemInstanceId: Schema.String, plugItemHashes: Schema.Array(Schema.Number) }),
  ),
)
const encodePlan = Schema.encodeEffect(PlanJson)
const encodeRecipe = Schema.encodeEffect(RecipeJson)
const encodeSnapshot = Schema.encodeEffect(SnapshotJson)
const decodeStored = Schema.decodeUnknownEffect(
  Schema.Struct({
    recipe: RecipeJson,
    plan: PlanJson,
    snapshot: Schema.NullOr(SnapshotJson),
  }),
)

const rowToBuild = (row: BuildRow): Effect.Effect<StoredBuild> =>
  decodeStored({ recipe: row.recipe, plan: row.plan, snapshot: row.in_game_snapshot }).pipe(
    Effect.orDie,
    Effect.map(({ recipe, plan, snapshot }) => ({
      id: row.id,
      jobId: row.job_id,
      name: row.name,
      recipe,
      plan,
      revision: row.revision,
      link:
        row.in_game_character_id === null ||
        row.in_game_index === null ||
        row.in_game_saved_at === null ||
        row.in_game_revision === null
          ? null
          : {
              characterId: row.in_game_character_id,
              index: row.in_game_index,
              savedAt: row.in_game_saved_at,
              revision: row.in_game_revision,
              snapshot,
            },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  )

export interface BuildsRepoService {
  readonly list: Effect.Effect<ReadonlyArray<StoredBuild>, SqlError.SqlError>
  readonly get: (id: string) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
  readonly byJob: (jobId: string) => Effect.Effect<Option.Option<StoredBuild>, SqlError.SqlError>
  readonly insert: (input: NewBuild) => Effect.Effect<StoredBuild, SqlError.SqlError>
  readonly rename: (
    id: string,
    name: string,
  ) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
  readonly revise: (
    id: string,
    content: BuildContent,
  ) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
  readonly remove: (id: string) => Effect.Effect<void, BuildNotFound | SqlError.SqlError>
  /**
   * Links the build to the slot as of its current revision, taking the slot
   * from any build that held it. A null snapshot waits for the slot to be seen
   * holding the build.
   */
  readonly claimInGameSlot: (
    id: string,
    slot: SlotKey,
    snapshot: SlotSnapshot | null,
  ) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
  /** Takes the snapshot of a link still waiting for one; a link that has one keeps it. */
  readonly adoptBaseline: (
    id: string,
    snapshot: SlotSnapshot,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly unlink: (id: string) => Effect.Effect<StoredBuild, BuildNotFound | SqlError.SqlError>
}

export class BuildsRepo extends Context.Service<BuildsRepo, BuildsRepoService>()('BuildsRepo') {}

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

    const revise = (id: string, content: BuildContent) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        const recipe = yield* encodeRecipe(content.recipe).pipe(Effect.orDie)
        const plan = yield* encodePlan(content.plan).pipe(Effect.orDie)
        return yield* touched(
          id,
          sql`
            UPDATE saved_builds
            SET name = ${content.name}, recipe = ${recipe}, plan = ${plan},
                revision = revision + 1, updated_at = ${now}
            WHERE id = ${id}
          `,
        )
      })

    const remove = (id: string) =>
      Effect.gen(function* () {
        yield* get(id)
        yield* sql`DELETE FROM saved_builds WHERE id = ${id}`
      })

    const claimInGameSlot = (id: string, slot: SlotKey, snapshot: SlotSnapshot | null) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        const encoded =
          snapshot === null ? null : yield* encodeSnapshot(snapshot).pipe(Effect.orDie)
        return yield* touched(
          id,
          Effect.andThen(
            sql`
              UPDATE saved_builds
              SET in_game_character_id = NULL, in_game_index = NULL, in_game_saved_at = NULL,
                  in_game_revision = NULL, in_game_snapshot = NULL, updated_at = ${now}
              WHERE in_game_character_id = ${slot.characterId} AND in_game_index = ${slot.index} AND id <> ${id}
            `,
            sql`
              UPDATE saved_builds
              SET in_game_character_id = ${slot.characterId}, in_game_index = ${slot.index},
                  in_game_saved_at = ${now}, in_game_revision = revision, in_game_snapshot = ${encoded}, updated_at = ${now}
              WHERE id = ${id}
            `,
          ),
        )
      }).pipe(sql.withTransaction)

    const adoptBaseline = (id: string, snapshot: SlotSnapshot) =>
      Effect.gen(function* () {
        const encoded = yield* encodeSnapshot(snapshot).pipe(Effect.orDie)
        yield* sql`
          UPDATE saved_builds SET in_game_snapshot = ${encoded}
          WHERE id = ${id} AND in_game_character_id IS NOT NULL AND in_game_snapshot IS NULL
        `
      })

    const unlink = (id: string) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        return yield* touched(
          id,
          sql`
            UPDATE saved_builds
            SET in_game_character_id = NULL, in_game_index = NULL, in_game_saved_at = NULL,
                in_game_revision = NULL, in_game_snapshot = NULL, updated_at = ${now}
            WHERE id = ${id}
          `,
        )
      })

    return {
      list,
      get,
      byJob,
      insert,
      rename,
      revise,
      remove,
      claimInGameSlot,
      adoptBaseline,
      unlink,
    }
  }),
)
