import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import {
  BungieAuthFailed,
  BungieAuthResult,
  BungieAuthStart,
  CreateJob,
  Health,
  Job,
  JobNotFound,
  RecentItem,
} from "./schemas"

// One HttpApi value describes every route. The server implements it with
// HttpApiBuilder and the app calls it with HttpApiClient, so there is no
// hand-written fetch code and no route string duplicated on either side.

export const healthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("status", "/health", { success: Health }),
)

export const jobsGroup = HttpApiGroup.make("jobs")
  .add(HttpApiEndpoint.get("list", "/jobs", { success: Schema.Array(Job) }))
  .add(HttpApiEndpoint.post("create", "/jobs", { payload: CreateJob, success: Job }))
  .add(
    HttpApiEndpoint.get("get", "/jobs/:id", {
      params: { id: Schema.String },
      success: Job,
      error: JobNotFound,
    }),
  )

export const inventoryGroup = HttpApiGroup.make("inventory").add(
  HttpApiEndpoint.get("recent", "/inventory/recent", { success: Schema.Array(RecentItem) }),
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
  .add(authGroup)
export type GhostApi = typeof GhostApi
