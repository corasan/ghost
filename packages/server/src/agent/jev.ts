import { noul, TypeSafeClient } from "@typesafe-ai/sdk"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { AppConfig } from "../config.ts"

export interface Candidate {
  readonly id: string
  readonly text: string
}

export class JevUnavailable extends Schema.TaggedError<JevUnavailable>()("JevUnavailable", {
  message: Schema.String,
}) {}

export interface JevShape {
  /** Each candidate's relevance to the intent, in [0, 1]: Jev's probability that it fits. */
  readonly rank: (
    intent: string,
    candidates: ReadonlyArray<Candidate>,
  ) => Effect.Effect<ReadonlyMap<string, number>, JevUnavailable>
}

export class Jev extends Context.Service<Jev, JevShape>()("Jev") {}

const CHARS_PER_TOKEN = 4
export const REQUEST_TOKENS = 32_000
const CONCURRENCY = 4

const fits = (candidate: Candidate) =>
  noul(
    {
      question: "Does the Destiny 2 item in `item` fit what the player asks for in `request`?",
      item: candidate.text,
    },
    {
      true: "Nothing about the item conflicts with `request`, and its class, element, stats or perks serve the goal `request` states.",
      false:
        "The item conflicts with something `request` names, such as a different class, element or activity, or none of its stats and perks serve the goal `request` states.",
    },
  )

export const requestBody = (
  model: string,
  intent: string,
  candidates: ReadonlyArray<Candidate>,
) => ({
  model,
  state: { request: intent },
  questions: Object.fromEntries(candidates.map((c) => [c.id, fits(c)])),
})

const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

export const chunk = (
  model: string,
  intent: string,
  candidates: ReadonlyArray<Candidate>,
  budget = REQUEST_TOKENS,
): ReadonlyArray<ReadonlyArray<Candidate>> => {
  const base = JSON.stringify(requestBody(model, intent, [])).length
  const chunks: Array<Array<Candidate>> = []
  let current: Array<Candidate> = []
  let size = base
  for (const candidate of candidates) {
    const cost = JSON.stringify({ [candidate.id]: fits(candidate) }).length - 1
    if (current.length > 0 && tokens(size + cost) > budget) {
      chunks.push(current)
      current = []
      size = base
    }
    current.push(candidate)
    size += cost
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const Answers = Schema.Record(Schema.String, Schema.Struct({ noul: Schema.Number }))

const unavailable = (error: unknown) => new JevUnavailable({ message: String(error) })

export const JevLive = Layer.effect(
  Jev,
  Effect.gen(function* () {
    const { jev } = yield* AppConfig
    const apiKey = Redacted.value(jev.apiKey)
    if (apiKey === "") {
      return {
        rank: () => Effect.fail(new JevUnavailable({ message: "TYPESAFE_API_KEY is not set" })),
      }
    }
    const client = new TypeSafeClient({
      apiKey,
      defaultModel: jev.model,
      timeout: 3_000,
      retry: { maxRetries: 1 },
    })

    const ask = (intent: string, candidates: ReadonlyArray<Candidate>) =>
      Effect.tryPromise({
        try: (signal) => client.systemOne(requestBody(jev.model, intent, candidates), { signal }),
        catch: unavailable,
      }).pipe(
        Effect.flatMap((response) =>
          Schema.decodeUnknownEffect(Answers)(response.answers).pipe(Effect.mapError(unavailable)),
        ),
      )

    const rank = (intent: string, candidates: ReadonlyArray<Candidate>) =>
      Effect.forEach(chunk(jev.model, intent, candidates), (part) => ask(intent, part), {
        concurrency: CONCURRENCY,
      }).pipe(
        Effect.map(
          (parts) =>
            new Map(
              parts.flatMap((answers) =>
                Object.entries(answers).map(([id, answer]) => [id, answer.noul] as const),
              ),
            ),
        ),
      )

    return { rank }
  }),
)
