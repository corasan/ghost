import { query } from "@anthropic-ai/claude-agent-sdk"
import { Context, Effect, Layer, Schema } from "effect"
import { AppConfig } from "../config.ts"
import { extractJson } from "../creators/parse.ts"
import { AgentFailed } from "./claude.ts"

export interface SituationalInput {
  readonly subclass: string
  readonly conditions: ReadonlyArray<{ readonly name: string; readonly description: string }>
  readonly mods: ReadonlyArray<{
    readonly name: string
    readonly copies: number
    readonly description: string
    /** Null when Ghost has no numbers on record and must look them up. */
    readonly known: string | null
  }>
}

const SourceOutput = Schema.Struct({
  label: Schema.String,
  url: Schema.NullOr(Schema.String),
  asOf: Schema.NullOr(Schema.String),
})

export const SituationalOutput = Schema.Struct({
  effects: Schema.Array(
    Schema.Struct({ mod: Schema.String, effect: Schema.String, source: SourceOutput }),
  ),
  summary: Schema.String,
})
export type SituationalOutput = typeof SituationalOutput.Type

export interface SituationalWriterShape {
  readonly write: (input: SituationalInput) => Effect.Effect<SituationalOutput, AgentFailed>
}

export class SituationalWriter extends Context.Service<SituationalWriter, SituationalWriterShape>()(
  "SituationalWriter",
) {}

const SYSTEM_PROMPT = `You are Ghost, a Destiny 2 companion. A player wants to know what the conditional bonuses on their equipped character add.

You get their subclass with its aspects and fragments, and their armor charge mods with copies slotted. Bungie's text for a charge mod only says "a small bonus", so:

1. For every mod whose known value is null, look up with WebSearch and WebFetch what it adds while the wearer has Armor Charge and how extra copies stack, for the current season. Prefer sources from the last 60 days: d2foundry.gg, destiny.report, Bungie's patch notes, and recent community testing. Never answer from memory.
2. Write summary: two or three short sentences, at most 60 words, plain text. Say what the bonuses add together once charge is up, how this character builds and keeps charge (orbs and the abilities or fragments that make them), and what drops when it runs out. Speak to the player as "you". Use stat names Health, Melee, Grenade, Super, Class, Weapons.

Return only a JSON object: {"effects":[{"mod":"...","effect":"...","source":{"label":"...","url":"...","asOf":"YYYY-MM-DD"}}],"summary":"..."}
- effects lists only the mods whose known value was null, with the mod name exactly as given. effect is one line in numbers, for example "+10% Arc weapon damage; 17% with two copies, 22% with three".
- If you cannot find numbers for a mod, leave it out of effects rather than guess.`

export const SituationalWriterLive = Layer.effect(
  SituationalWriter,
  Effect.gen(function* () {
    const config = yield* AppConfig

    const write = (input: SituationalInput) =>
      Effect.tryPromise({
        try: async () => {
          const prompt = [
            `Subclass: ${input.subclass}`,
            "Aspects and fragments:",
            ...input.conditions.map((c) => `- ${c.name}: ${c.description}`),
            "Armor charge mods:",
            ...input.mods.map(
              (m) => `- ${m.name} ×${m.copies}: ${m.description} Known value: ${m.known ?? "null"}`,
            ),
          ].join("\n")
          for await (const message of query({
            prompt,
            options: {
              model: config.model,
              systemPrompt: SYSTEM_PROMPT,
              tools: ["WebSearch", "WebFetch"],
              allowedTools: ["WebSearch", "WebFetch"],
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
              maxTurns: 20,
            },
          })) {
            if (message.type === "result") {
              if (message.subtype === "success") return message.result
              throw new Error(`situational ended with ${message.subtype}`)
            }
          }
          throw new Error("situational returned nothing")
        },
        catch: (error) => new AgentFailed({ message: String(error) }),
      }).pipe(
        Effect.flatMap((text) =>
          Effect.try({
            try: () => extractJson(text),
            catch: (error) => new AgentFailed({ message: String(error) }),
          }),
        ),
        Effect.flatMap((json) =>
          Schema.decodeUnknownEffect(SituationalOutput)(json).pipe(
            Effect.mapError((error) => new AgentFailed({ message: String(error) })),
          ),
        ),
      )

    return { write }
  }),
)
