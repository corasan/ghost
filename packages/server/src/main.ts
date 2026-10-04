import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { ClaudeAgentLive } from "./agent/claude.ts"
import { JobRunnerLive } from "./agent/runner.ts"
import { ApiLive } from "./api/index.ts"
import { BungieClientLive } from "./bungie/client.ts"
import { AppConfig, AppConfigLive } from "./config.ts"
import { DatabaseLive } from "./db/client.ts"
import { ItemsRepoLive } from "./db/items.ts"
import { JobsRepoLive } from "./db/jobs.ts"
import { SettingsLive } from "./db/settings.ts"
import { McpLive } from "./mcp/server.ts"

// Layers compose bottom-up: config -> database -> repositories -> clients ->
// HTTP routes. Each layer declares what it needs in its type, so a missing
// dependency is a compile error here rather than a crash on first request.
const Repositories = Layer.mergeAll(JobsRepoLive, ItemsRepoLive, SettingsLive).pipe(
  Layer.provideMerge(DatabaseLive),
)

const Services = Layer.mergeAll(BungieClientLive, ClaudeAgentLive).pipe(
  Layer.provideMerge(Repositories),
)

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
  Layer.provide(Services),
  Layer.provide(ServerLive),
  Layer.provide(AppConfigLive),
)

BunRuntime.runMain(Layer.launch(Main))
