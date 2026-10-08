import { Config, Context, Effect, Layer, Redacted } from "effect"

export interface AppConfigValues {
  readonly host: string
  readonly port: number
  readonly dataDir: string
  readonly model: string
  readonly effort: string
  /** The Claude Code executable the agent runs; empty uses the one bundled with the SDK. */
  readonly claudePath: string
  /** Comma-separated @handles, UC… channel ids or names to search; empty turns creator notes off. */
  readonly youtubeChannels: string
  readonly bungie: {
    readonly apiKey: Redacted.Redacted<string>
    readonly clientId: string
    readonly clientSecret: Redacted.Redacted<string>
  }
  readonly jev: {
    readonly apiKey: Redacted.Redacted<string>
    readonly model: string
  }
}

export class AppConfig extends Context.Service<AppConfig, AppConfigValues>()("AppConfig") {}

// Every setting is read once at startup. Config.withDefault keeps local runs
// zero-config; the Bungie values default to empty so the server boots before
// you have registered an application, and the health endpoint reports that.
const config = Config.all({
  host: Config.String("GHOST_HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.Port("GHOST_PORT").pipe(Config.withDefault(4848)),
  dataDir: Config.String("GHOST_DATA_DIR").pipe(Config.withDefault("./data")),
  model: Config.String("GHOST_MODEL").pipe(Config.withDefault("claude-sonnet-5-5")),
  effort: Config.String("GHOST_EFFORT").pipe(Config.withDefault("high")),
  claudePath: Config.String("GHOST_CLAUDE_PATH").pipe(Config.withDefault("")),
  youtubeChannels: Config.String("GHOST_YOUTUBE_CHANNELS").pipe(
    Config.withDefault("@Datto,@CammyCakes,@FalloutPlays,Aegis Destiny 2"),
  ),
  bungie: Config.all({
    apiKey: Config.Redacted("BUNGIE_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    clientId: Config.String("BUNGIE_CLIENT_ID").pipe(Config.withDefault("")),
    clientSecret: Config.Redacted("BUNGIE_CLIENT_SECRET").pipe(
      Config.withDefault(Redacted.make("")),
    ),
  }),
  jev: Config.all({
    apiKey: Config.Redacted("TYPESAFE_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    model: Config.String("GHOST_JEV_MODEL").pipe(Config.withDefault("jev-latest")),
  }),
})

export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.map(config, (c): AppConfigValues => c),
)
