import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import {
  AgentSettings,
  ApplyPlan,
  Briefing,
  BuildNotFound,
  BungieAuthFailed,
  BungieAuthResult,
  BungieAuthStart,
  BungieFailed,
  BungieNotLinked,
  ChatSession,
  CleanupNotFound,
  CleanupPreview,
  CleanupRefused,
  CleanupSession,
  CreateJob,
  EquipBuild,
  EquipBuildResult,
  GuardianSituational,
  GuardianSnapshot,
  Health,
  HistoryGroup,
  ItemAction,
  ItemDetail,
  ItemNotFound,
  Job,
  JobNotFound,
  LoadoutSlotInvalid,
  LoadoutSlots,
  PlanNotApplicable,
  RecentItem,
  RenameBuild,
  SaveBuild,
  SaveBuildResult,
  SavedBuild,
  SetAgentSettings,
  SetDecision,
  JudgeUnavailable,
  SetPerkRating,
  WeaponPerks,
  CleanupItems,
  ReviewItem,
  StartCleanup,
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
  .add(
    HttpApiEndpoint.get("list", "/jobs", {
      query: { sessionId: Schema.optional(Schema.String) },
      success: Schema.Array(Job),
    }),
  )
  .add(HttpApiEndpoint.get("sessions", "/sessions", { success: Schema.Array(ChatSession) }))
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

const perkErrors = [
  ItemNotFound.pipe(HttpApiSchema.status(404)),
  JudgeUnavailable.pipe(HttpApiSchema.status(503)),
  ...bungieErrors,
] as const

export const itemsGroup = HttpApiGroup.make("items")
  .add(
    HttpApiEndpoint.get("detail", "/items/:id", {
      params: { id: Schema.String },
      success: ItemDetail,
      error: [ItemNotFound.pipe(HttpApiSchema.status(404)), ...bungieErrors],
    }),
  )
  .add(
    HttpApiEndpoint.post("act", "/items/:id/action", {
      params: { id: Schema.String },
      payload: ItemAction,
      success: Job,
      error: [ItemNotFound.pipe(HttpApiSchema.status(404)), ...planErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("perks", "/items/:id/perks", {
      params: { id: Schema.String },
      success: WeaponPerks,
      error: perkErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("ratePerk", "/items/:id/perks", {
      params: { id: Schema.String },
      payload: SetPerkRating,
      success: WeaponPerks,
      error: perkErrors,
    }),
  )

export const guardianGroup = HttpApiGroup.make("guardian")
  .add(
    HttpApiEndpoint.get("snapshot", "/guardian", {
      success: GuardianSnapshot,
      error: bungieErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("situational", "/guardian/situational", {
      query: { characterId: Schema.String },
      success: GuardianSituational,
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

const buildErrors = [
  BuildNotFound.pipe(HttpApiSchema.status(404)),
  LoadoutSlotInvalid.pipe(HttpApiSchema.status(400)),
  ...planErrors,
] as const

export const buildsGroup = HttpApiGroup.make("builds")
  .add(HttpApiEndpoint.get("list", "/builds", { success: Schema.Array(SavedBuild) }))
  .add(
    HttpApiEndpoint.post("save", "/builds", {
      payload: SaveBuild,
      success: SaveBuildResult,
      error: buildErrors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("rename", "/builds/:id", {
      params: { id: Schema.String },
      payload: RenameBuild,
      success: SavedBuild,
      error: BuildNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", "/builds/:id", {
      params: { id: Schema.String },
      error: BuildNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.post("equip", "/builds/:id/equip", {
      params: { id: Schema.String },
      payload: EquipBuild,
      success: EquipBuildResult,
      error: buildErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("slots", "/loadouts", {
      query: { characterId: Schema.String },
      success: LoadoutSlots,
      error: bungieErrors,
    }),
  )

export const agentGroup = HttpApiGroup.make("agent")
  .add(HttpApiEndpoint.get("settings", "/agent", { success: AgentSettings }))
  .add(
    HttpApiEndpoint.post("configure", "/agent", {
      payload: SetAgentSettings,
      success: AgentSettings,
    }),
  )

const cleanupErrors = [
  CleanupNotFound.pipe(HttpApiSchema.status(404)),
  CleanupRefused.pipe(HttpApiSchema.status(409)),
] as const

const cleanupCommand = {
  params: { id: Schema.String },
  success: CleanupSession,
  error: cleanupErrors,
}

export const cleanupGroup = HttpApiGroup.make("cleanup")
  .add(
    HttpApiEndpoint.get("preview", "/cleanup/preview", {
      query: { characterId: Schema.String },
      success: CleanupPreview,
      error: [CleanupRefused.pipe(HttpApiSchema.status(409)), ...bungieErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("current", "/cleanup/current", {
      success: Schema.NullOr(CleanupSession),
    }),
  )
  .add(
    HttpApiEndpoint.post("start", "/cleanup/start", {
      payload: StartCleanup,
      success: CleanupSession,
      error: [CleanupRefused.pipe(HttpApiSchema.status(409)), ...bungieErrors],
    }),
  )
  .add(
    HttpApiEndpoint.get("review", "/cleanup/review", {
      success: Schema.Array(ReviewItem),
      error: [JudgeUnavailable.pipe(HttpApiSchema.status(503)), ...bungieErrors],
    }),
  )
  .add(HttpApiEndpoint.post("pause", "/cleanup/:id/pause", cleanupCommand))
  .add(HttpApiEndpoint.post("resume", "/cleanup/:id/resume", cleanupCommand))
  .add(HttpApiEndpoint.post("stop", "/cleanup/:id/stop", cleanupCommand))
  .add(HttpApiEndpoint.post("skip", "/cleanup/:id/skip", cleanupCommand))
  .add(HttpApiEndpoint.post("return", "/cleanup/:id/return", cleanupCommand))
  .add(HttpApiEndpoint.post("close", "/cleanup/:id/close", cleanupCommand))
  .add(
    HttpApiEndpoint.post("keep", "/cleanup/:id/keep", {
      params: { id: Schema.String },
      payload: CleanupItems,
      success: CleanupSession,
      error: cleanupErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleted", "/cleanup/:id/deleted", {
      params: { id: Schema.String },
      payload: CleanupItems,
      success: CleanupSession,
      error: cleanupErrors,
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
  .add(itemsGroup)
  .add(guardianGroup)
  .add(buildsGroup)
  .add(agentGroup)
  .add(cleanupGroup)
  .add(authGroup)
export type GhostApi = typeof GhostApi
