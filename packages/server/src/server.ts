import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ActivityLive } from "./activity/activity.ts"
import { ClaudeAgentLive } from "./agent/claude.ts"
import { SummarizerLive } from "./agent/summarize.ts"
import { SituationalWriterLive } from "./agent/situational.ts"
import { CurrentJobLive } from "./agent/current-job.ts"
import { JevLive } from "./agent/jev.ts"
import { JobRunnerLive } from "./agent/runner.ts"
import { AgentConfigLive } from "./agent/settings.ts"
import { AccessGuard, AccessLive } from "./access.ts"
import { ApiLive } from "./api/index.ts"
import { ArtifactsLive } from "./bungie/artifact.ts"
import { CleanupRepoLive } from "./cleanup/repo.ts"
import { CleanupLive, CleanupWatcherLive } from "./cleanup/service.ts"
import { BuildsLive } from "./builds/builds.ts"
import { BungieClientLive } from "./bungie/client.ts"
import { GuardianLive } from "./bungie/guardian.ts"
import { LoadoutsLive } from "./bungie/loadouts.ts"
import { ManifestLive } from "./bungie/manifest.ts"
import { MembershipLive } from "./bungie/membership.ts"
import { ProfileRefreshLive, ProfileStoreLive } from "./bungie/profile.ts"
import { AppConfig, AppConfigLive } from "./config.ts"
import { CreatorNotesLive, CreatorRefreshLive } from "./creators/creators.ts"
import { ActionsRepoLive } from "./db/actions.ts"
import { BuildsRepoLive } from "./db/builds.ts"
import { PerkRatingsLive } from "./db/perk-ratings.ts"
import { ChargeEffectsLive } from "./db/charge.ts"
import { DatabaseLive } from "./db/client.ts"
import { ItemsRepoLive } from "./db/items.ts"
import { JobsRepoLive } from "./db/jobs.ts"
import { JunkJudgeLive } from "./junk/service.ts"
import { SettingsLive } from "./db/settings.ts"
import { ItemsLive } from "./items/items.ts"
import { LoggerLive, requestLogger } from "./log.ts"
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
  BuildsRepoLive,
  PerkRatingsLive,
  SettingsLive,
  ChargeEffectsLive,
  CleanupRepoLive,
).pipe(Layer.provideMerge(DatabaseLive))

const Clients = Layer.mergeAll(
  BungieClientLive,
  ManifestLive,
  WishlistLive,
  ClaudeAgentLive,
  SummarizerLive,
  SituationalWriterLive,
  CurrentJobLive,
  JevLive,
).pipe(
  Layer.provideMerge(AgentConfigLive),
  Layer.provideMerge(AccessLive),
  Layer.provideMerge(Repositories),
)

const Profile = Layer.mergeAll(ProfileStoreLive, CreatorNotesLive).pipe(
  Layer.provideMerge(MembershipLive),
  Layer.provideMerge(Clients),
)

const Reads = LoadoutsLive.pipe(Layer.provideMerge(Profile))

const Services = Layer.mergeAll(
  GuardianLive,
  ActivityLive,
  PlansLive,
  ArtifactsLive,
  CleanupLive,
  JunkJudgeLive,
).pipe(Layer.provideMerge(Reads))

const Actions = Layer.mergeAll(ItemsLive, BuildsLive).pipe(Layer.provideMerge(Services))

const Routes = Layer.mergeAll(ApiLive, McpLive, AccessGuard)

const ListenLive = Layer.unwrap(
  Effect.gen(function* () {
    const { host, port } = yield* AppConfig
    return BunHttpServer.layer({ hostname: host, port })
  }),
)

export const ServerLive = HttpRouter.serve(Routes, {
  disableLogger: true,
  middleware: requestLogger,
}).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.merge(JobRunnerLive),
  Layer.merge(CleanupWatcherLive),
  Layer.merge(ProfileRefreshLive),
  Layer.merge(CreatorRefreshLive),
  Layer.provide(Actions),
  Layer.provide(ListenLive),
  Layer.provide(AppConfigLive),
  Layer.provide(LoggerLive),
)
