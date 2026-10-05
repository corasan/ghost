import { AgentEffort, AgentSettings } from "@ghost/contract"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { AppConfig } from "../config.ts"
import { Settings } from "../db/settings.ts"

const KEY = "agent.effort"
const DEFAULT_EFFORT: AgentEffort = "high"

const decode = Schema.decodeUnknownOption(AgentEffort)

/** The effort chosen in the app wins, then GHOST_EFFORT, then high. */
export const resolveEffort = (chosen: string | null, configured: string): AgentEffort =>
  Option.getOrElse(decode(chosen), () => Option.getOrElse(decode(configured), () => DEFAULT_EFFORT))

export interface AgentConfigShape {
  readonly current: Effect.Effect<AgentSettings>
  readonly setEffort: (effort: AgentEffort) => Effect.Effect<AgentSettings>
}

export class AgentConfig extends Context.Service<AgentConfig, AgentConfigShape>()("AgentConfig") {}

export const AgentConfigLive = Layer.effect(
  AgentConfig,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const settings = yield* Settings

    const current = settings.get(KEY).pipe(
      Effect.orDie,
      Effect.map(
        (chosen) =>
          new AgentSettings({
            model: config.model,
            effort: resolveEffort(Option.getOrNull(chosen), config.effort),
          }),
      ),
    )

    return {
      current,
      setEffort: (effort) => settings.set(KEY, effort).pipe(Effect.orDie, Effect.andThen(current)),
    }
  }),
)
