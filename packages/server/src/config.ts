import { Config, Context, Effect, Layer, Redacted } from "effect"

export interface AppConfigShape {
  readonly host: string
  readonly port: number
  readonly dataDir: string
  readonly model: string
  readonly bungie: {
    readonly apiKey: Redacted.Redacted<string>
    readonly clientId: string
    readonly clientSecret: Redacted.Redacted<string>
  }
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("AppConfig") {}

// The server listens on loopback only; `bun run serve` puts it on the tailnet
// over https through Tailscale Serve. Every setting is read once at startup. Config.withDefault keeps local runs
// zero-config; the Bungie values default to empty so the server boots before
// you have registered an application, and the health endpoint reports that.
const config = Config.all({
  host: Config.String("GHOST_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("GHOST_PORT").pipe(Config.withDefault(4848)),
  dataDir: Config.String("GHOST_DATA_DIR").pipe(Config.withDefault("./data")),
  model: Config.String("GHOST_MODEL").pipe(Config.withDefault("claude-sonnet-5-5")),
  bungie: Config.all({
    apiKey: Config.Redacted("BUNGIE_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    clientId: Config.String("BUNGIE_CLIENT_ID").pipe(Config.withDefault("")),
    clientSecret: Config.Redacted("BUNGIE_CLIENT_SECRET").pipe(
      Config.withDefault(Redacted.make("")),
    ),
  }),
})

export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.map(config, (c): AppConfigShape => c),
)
