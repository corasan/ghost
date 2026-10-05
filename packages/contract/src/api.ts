import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import {
  ApplyPlan,
  Briefing,
  BungieAuthFailed,
  BungieAuthResult,
  BungieAuthStart,
  BungieFailed,
  BungieNotLinked,
  CreateJob,
  GuardianSnapshot,
  Health,
  HistoryGroup,
  Job,
  JobNotFound,
  PlanNotApplicable,
  RecentItem,
  SetDecision,
  VaultSnapshot,
} from "./schemas"

// One HttpApi value describes every route. The server implements it with
// HttpApiBuilder and the app calls it with HttpApiClient, so there is no
// hand-written fetch code and no route string duplicated on either side.

export const healthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("status", "/health", { success: Health }),
)

// 409: the account is not linked yet, so the request cannot be fulfilled
// until the user completes OAuth. 502: Bungie answered with an error.
const bungieErrors = [
  BungieNotLinked.pipe(HttpApiSchema.status(409)),
  BungieFailed.pipe(HttpApiSchema.status(502)),
] as const

const planErrors = [
  JobNotFound.pipe(HttpApiSchema.status(404)),
  PlanNotApplicable.pipe(HttpApiSchema.status(409)),
  ...bungieErrors,
] as const

export const jobsGroup = HttpApiGroup.make("jobs")
  .add(HttpApiEndpoint.get("list", "/jobs", { success: Schema.Array(Job) }))
  .add(HttpApiEndpoint.post("create", "/jobs", { payload: CreateJob, success: Job }))
  .add(
    HttpApiEndpoint.get("get", "/jobs/:id", {
      params: { id: Schema.String },
      success: Job,
      error: JobNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  // Confirming a plan is the only way anything moves. The server runs the
  // selected rows itself and journals each call so it can be undone.
  .add(
    HttpApiEndpoint.post("apply", "/jobs/:id/apply", {
      params: { id: Schema.String },
      payload: ApplyPlan,
      success: Job,
      error: planErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("undo", "/jobs/:id/undo", {
      params: { id: Schema.String },
      success: Job,
      error: planErrors,
    }),
  )
  .add(HttpApiEndpoint.get("history", "/history", { success: Schema.Array(HistoryGroup) }))

export const inventoryGroup = HttpApiGroup.make("inventory")
  .add(
    HttpApiEndpoint.get("recent", "/inventory/recent", {
      query: { characterId: Schema.optional(Schema.String) },
      success: Schema.Array(RecentItem),
    }),
  )
  .add(
    HttpApiEndpoint.post("decide", "/inventory/recent/:id/decision", {
      params: { id: Schema.String },
      payload: SetDecision,
      success: RecentItem,
    }),
  )

export const guardianGroup = HttpApiGroup.make("guardian")
  .add(
    HttpApiEndpoint.get("snapshot", "/guardian", {
      success: GuardianSnapshot,
      error: bungieErrors,
    }),
  )
  .add(HttpApiEndpoint.get("vault", "/vault", { success: VaultSnapshot, error: bungieErrors }))
  .add(
    HttpApiEndpoint.get("briefing", "/briefing", {
      query: { characterId: Schema.optional(Schema.String) },
      success: Briefing,
      error: bungieErrors,
    }),
  )

export const authGroup = HttpApiGroup.make("auth")
  .add(HttpApiEndpoint.get("start", "/auth/bungie/start", { success: BungieAuthStart }))
  .add(
    HttpApiEndpoint.get("callback", "/auth/bungie/callback", {
      query: { code: Schema.String },
      success: BungieAuthResult,
      error: BungieAuthFailed,
    }),
  )

export const GhostApi = HttpApi.make("ghost")
  .add(healthGroup)
  .add(jobsGroup)
  .add(inventoryGroup)
  .add(guardianGroup)
  .add(authGroup)
export type GhostApi = typeof GhostApi
