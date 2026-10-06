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

/** What a candidate is, which sets the question Jev answers about it. */
export type Subject = "item" | "set bonus"

export interface JevService {
  /** Each candidate's relevance to the intent, in [0, 1]: Jev's probability that it fits. */
  readonly rank: (
    intent: string,
    candidates: ReadonlyArray<Candidate>,
    subject?: Subject,
  ) => Effect.Effect<ReadonlyMap<string, number>, JevUnavailable>
}

export class Jev extends Context.Service<Jev, JevService>()("Jev") {}

const CHARS_PER_TOKEN = 4
export const REQUEST_TOKENS = 32_000
const CONCURRENCY = 4

interface Question {
  readonly question: string
  readonly true: string
  readonly false: string
}

const QUESTIONS: Record<Subject, Question> = {
  item: {
    question: "Does the Destiny 2 item in `item` fit what the player asks for in `request`?",
    true: "Nothing about the item conflicts with `request`, and its class, element, stats or perks serve the goal `request` states.",
    false:
      "The item conflicts with something `request` names, such as a different class, element or activity, or none of its stats and perks serve the goal `request` states.",
  },
  "set bonus": {
    question:
      "Does the Destiny 2 armor set bonus in `item` help the build the player asks for in `request`?",
    true: "The bonus's effect triggers from or feeds the subclass, element, abilities, weapons or activity `request` describes.",
    false:
      "The bonus's effect needs a different element, ability, weapon type or activity than `request` describes, or does nothing for its goal.",
  },
}

const fits = (candidate: Candidate, subject: Subject) => {
  const { question, true: yes, false: no } = QUESTIONS[subject]
  return noul({ question, item: candidate.text }, { true: yes, false: no })
}

export const requestBody = (
  model: string,
  intent: string,
  candidates: ReadonlyArray<Candidate>,
  subject: Subject = "item",
) => ({
  model,
  state: { request: intent },
  questions: Object.fromEntries(candidates.map((c) => [c.id, fits(c, subject)])),
})

const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

export const chunk = (
  model: string,
  intent: string,
  candidates: ReadonlyArray<Candidate>,
  subject: Subject = "item",
  budget = REQUEST_TOKENS,
): ReadonlyArray<ReadonlyArray<Candidate>> => {
  const base = JSON.stringify(requestBody(model, intent, [], subject)).length
  const chunks: Array<Array<Candidate>> = []
  let current: Array<Candidate> = []
  let size = base
  for (const candidate of candidates) {
    const cost = JSON.stringify({ [candidate.id]: fits(candidate, subject) }).length - 1
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

const unavailable = (cause: unknown) => new JevUnavailable({ message: String(cause) })

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

    const ask = (intent: string, candidates: ReadonlyArray<Candidate>, subject: Subject) =>
      Effect.tryPromise({
        try: (signal) =>
          client.systemOne(requestBody(jev.model, intent, candidates, subject), { signal }),
        catch: unavailable,
      }).pipe(
        Effect.flatMap((response) =>
          Schema.decodeUnknownEffect(Answers)(response.answers).pipe(Effect.mapError(unavailable)),
        ),
      )

    const rank = (
      intent: string,
      candidates: ReadonlyArray<Candidate>,
      subject: Subject = "item",
    ) =>
      Effect.forEach(
        chunk(jev.model, intent, candidates, subject),
        (part) => ask(intent, part, subject),
        { concurrency: CONCURRENCY },
      ).pipe(
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
