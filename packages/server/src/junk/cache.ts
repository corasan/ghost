import { createHash } from "node:crypto"
import { Context, DateTime, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { type Candidate, type JevService, QUESTIONS, type Subject } from "../agent/jev.ts"

export interface JevAnswersService {
  readonly get: (keys: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, number>>
  readonly put: (answers: ReadonlyArray<readonly [string, number]>) => Effect.Effect<void>
}

export class JevAnswers extends Context.Service<JevAnswers, JevAnswersService>()("JevAnswers") {}

const BATCH = 500

export const JevAnswersLive = Layer.effect(
  JevAnswers,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const get = (keys: ReadonlyArray<string>) =>
      Effect.forEach(
        Array.from({ length: Math.ceil(keys.length / BATCH) }, (_, i) =>
          keys.slice(i * BATCH, (i + 1) * BATCH),
        ),
        (part) =>
          sql<{ key: string; answer: number }>`
            SELECT key, answer FROM jev_answers WHERE key IN ${sql.in(part)}
          `,
      ).pipe(
        Effect.map((parts) => new Map(parts.flat().map((row) => [row.key, row.answer]))),
        Effect.orDie,
      )
    const put = (answers: ReadonlyArray<readonly [string, number]>) =>
      Effect.gen(function* () {
        if (answers.length === 0) return
        const now = DateTime.formatIso(yield* DateTime.now)
        const rows = answers.map(([key, answer]) => ({ key, answer, created_at: now }))
        for (let i = 0; i < rows.length; i += BATCH) {
          yield* sql`
            INSERT INTO jev_answers ${sql.insert(rows.slice(i, i + BATCH))}
            ON CONFLICT(key) DO NOTHING
          `
        }
      }).pipe(Effect.orDie)
    return { get, put }
  }),
)

// The question's wording is part of the key, so rewording it asks Jev afresh.
export const answerKey = (model: string, subject: Subject, request: string, item: string) =>
  createHash("sha256")
    .update(JSON.stringify([model, QUESTIONS[subject], request, item]))
    .digest("hex")

/** Jev that answers each question it has seen before from the cache and only asks the rest. */
export const cachedJev = (
  jev: JevService,
  answers: JevAnswersService,
  model: string,
): JevService => ({
  rank: (intent: string, candidates: ReadonlyArray<Candidate>, subject: Subject = "item") =>
    Effect.gen(function* () {
      const keyOf = new Map(
        candidates.map((c) => [c.id, answerKey(model, subject, intent, c.text)]),
      )
      const key = (c: Candidate) => keyOf.get(c.id) ?? ""
      const known = yield* answers.get([...new Set(keyOf.values())])
      const missing = candidates.filter((c) => !known.has(key(c)))
      const fresh =
        missing.length === 0 ? new Map<string, number>() : yield* jev.rank(intent, missing, subject)
      yield* answers.put(
        missing.flatMap((c) => {
          const answer = fresh.get(c.id)
          return answer === undefined ? [] : [[key(c), answer] as const]
        }),
      )
      return new Map(
        candidates.flatMap((c) => {
          const answer = known.get(key(c)) ?? fresh.get(c.id)
          return answer === undefined ? [] : [[c.id, answer] as const]
        }),
      )
    }),
})
