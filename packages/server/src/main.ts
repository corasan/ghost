import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ActivityLive } from "./activity/activity.ts"
import { ClaudeAgentLive } from "./agent/claude.ts"
import { SummarizerLive } from "./agent/summarize.ts"
import { SituationalWriterLive } from "./agent/situational.ts"
import { CurrentJobLive } from "./agent/current-job.ts"
import { JobRunnerLive } from "./agent/runner.ts"
import { AgentConfigLive } from "./agent/settings.ts"
import { ApiLive } from "./api/index.ts"
import { BungieClientLive } from "./bungie/client.ts"
import { GuardianLive } from "./bungie/guardian.ts"
import { ManifestLive } from "./bungie/manifest.ts"
import { ProfileRefreshLive, ProfileStoreLive } from "./bungie/profile.ts"
import { AppConfig, AppConfigLive } from "./config.ts"
import { CreatorNotesLive, CreatorRefreshLive } from "./creators/creators.ts"
import { ActionsRepoLive } from "./db/actions.ts"
import { ChargeEffectsLive } from "./db/charge.ts"
import { DatabaseLive } from "./db/client.ts"
import { ItemsRepoLive } from "./db/items.ts"
import { JobsRepoLive } from "./db/jobs.ts"
import { SettingsLive } from "./db/settings.ts"
import { ItemsLive } from "./items/items.ts"
import { McpLive } from "./mcp/server.ts"
import { PlansLive } from "./plans/executor.ts"
import { WishlistLive } from "./wishlist/wishlist.ts"

// Layers compose bottom-up: config -> database -> repositories -> clients ->
// HTTP routes. Each layer declares what it needs in its type, so a missing
// dependency is a compile error here rather than a crash on first request.
const Repositories = Layer.mergeAll(
  JobsRepoLive,
  ItemsRepoLive,
  ActionsRepoLive,
  SettingsLive,
  ChargeEffectsLive,
).pipe(Layer.provideMerge(DatabaseLive))

const Clients = Layer.mergeAll(
  BungieClientLive,
  ManifestLive,
  WishlistLive,
  ClaudeAgentLive,
  SummarizerLive,
  SituationalWriterLive,
  CurrentJobLive,
).pipe(Layer.provideMerge(AgentConfigLive), Layer.provideMerge(Repositories))

const Profile = Layer.mergeAll(ProfileStoreLive, CreatorNotesLive).pipe(Layer.provideMerge(Clients))

const Services = Layer.mergeAll(GuardianLive, ActivityLive, PlansLive).pipe(
  Layer.provideMerge(Profile),
)

const Actions = ItemsLive.pipe(Layer.provideMerge(Services))

const Routes = Layer.mergeAll(ApiLive, McpLive)

const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { host, port } = yield* AppConfig
    return BunHttpServer.layer({ hostname: host, port })
  }),
)

const Main = HttpRouter.serve(Routes).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.merge(JobRunnerLive),
  Layer.merge(ProfileRefreshLive),
  Layer.merge(CreatorRefreshLive),
  Layer.provide(Actions),
  Layer.provide(ServerLive),
  Layer.provide(AppConfigLive),
)

BunRuntime.runMain(Layer.launch(Main))
