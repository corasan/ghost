import { query } from "@anthropic-ai/claude-agent-sdk"
import { Context, Effect, Layer, Schema } from "effect"
import { AppConfig } from "../config.ts"
import { extractJsonText, SummaryOutput } from "../creators/parse.ts"
import { abortOn, AgentFailed, within } from "./claude.ts"

export interface VideoToSummarize {
  readonly channelTitle: string
  readonly title: string
  readonly publishedAt: string
  /** "[m:ss] text" paragraphs from captions, or the title and description. */
  readonly text: string
  readonly timed: boolean
}

export interface SummarizerService {
  readonly summarize: (video: VideoToSummarize) => Effect.Effect<SummaryOutput, AgentFailed>
}

export class Summarizer extends Context.Service<Summarizer, SummarizerService>()("Summarizer") {}

const SYSTEM_PROMPT = `You turn a Destiny 2 creator's video into short notes for a companion app that advises players.

Return only a JSON object: {"notes":[{"topic":"...","claim":"...","startSec":0,"names":["..."]}]}

- topic is one of build, weapon, perk, mod, exotic, subclass, activity, patch, meta.
- claim is one specific, self-contained sentence of advice or fact the creator states: what to use or avoid, a god roll, a build and why it works, a buff or nerf, a meta call for an activity. Write it so it makes sense without the video. Never add anything the video does not say, and keep the creator's hedges ("in my testing", "for now").
- startSec is the second the claim is made, from the nearest [m:ss] marker before it; null when the text has no markers.
- names lists the exact in-game names of every weapon, armor piece, exotic, perk, mod, aspect, fragment or subclass the claim mentions. Not activities, seasons or people. Captions often mishear names; correct one only when you are sure of the real name, otherwise leave it as heard.
- Skip sponsor reads, jokes, giveaways and anything that is not Destiny 2 gameplay. At most 12 notes, the most useful first.
- If the video is not about Destiny 2 gameplay, return {"notes":[]}.`

// One call per new video, with no tools: the model only reads the text it is
// given. What it returns is checked against a schema here and against the
// Bungie manifest by the caller, so an invented item name never reaches the
// agent as fact.
export const SummarizerLive = Layer.effect(
  Summarizer,
  Effect.gen(function* () {
    const config = yield* AppConfig

    const summarize = (video: VideoToSummarize) =>
      Effect.tryPromise({
        try: async (signal) => {
          const prompt = [
            `Channel: ${video.channelTitle}`,
            `Video: ${video.title}`,
            `Published: ${video.publishedAt}`,
            video.timed ? "Transcript:" : "No captions were available; title and description:",
            video.text,
          ].join("\n")
          for await (const message of query({
            prompt,
            options: {
              model: config.model,
              systemPrompt: SYSTEM_PROMPT,
              tools: [],
              maxTurns: 1,
              abortController: abortOn(signal),
            },
          })) {
            if (message.type === "result") {
              if (message.subtype === "success") return message.result
              throw new Error(`summary ended with ${message.subtype}`)
            }
          }
          throw new Error("summary returned nothing")
        },
        catch: (error) => new AgentFailed({ message: String(error) }),
      }).pipe(
        within("3 minutes", "The summary"),
        Effect.flatMap((text) =>
          Effect.try({
            try: () => extractJsonText(text),
            catch: (error) => new AgentFailed({ message: String(error) }),
          }),
        ),
        Effect.flatMap((json) =>
          Schema.decodeEffect(Schema.fromJsonString(SummaryOutput))(json).pipe(
            Effect.mapError((error) => new AgentFailed({ message: String(error) })),
          ),
        ),
      )

    return { summarize }
  }),
)
