import { Effect, Layer, Option } from "effect"
import { JobsRepo } from "../db/jobs.ts"
import { ClaudeAgent } from "./claude.ts"
import { CurrentJob } from "./current-job.ts"

// One daemon fiber drains the queue. Polling SQLite every two seconds is
// deliberately boring: a job row is the unit of work, so a crash mid-run
// leaves it in `running` and a restart can be told to retry, and the mobile
// app only ever reads rows. One job at a time also avoids two agents racing
// to move the same items.
const tick = Effect.gen(function* () {
  const jobs = yield* JobsRepo
  const agent = yield* ClaudeAgent
  const current = yield* CurrentJob
  const next = yield* jobs.nextQueued
  if (Option.isNone(next)) return
  const job = next.value
  yield* jobs.setStatus(job.id, "running")
  yield* Effect.logInfo(`job ${job.id} (${job.kind}) started`)
  const outcome = yield* agent
    .run(job.kind, job.prompt, job.characterId)
    .pipe(current.around({ id: job.id, characterId: job.characterId }), Effect.result)
  if (outcome._tag === "Success") {
    yield* jobs.setStatus(job.id, "done", { result: outcome.success })
    yield* Effect.logInfo(`job ${job.id} done`)
  } else {
    yield* jobs.setStatus(job.id, "failed", { error: outcome.failure.message })
    yield* Effect.logWarning(`job ${job.id} failed: ${outcome.failure.message}`)
  }
})

const loop = tick.pipe(
  Effect.catchCause((cause) => Effect.logError("job runner tick failed", cause)),
  Effect.delay("2 seconds"),
  Effect.forever,
)

export const JobRunnerLive = Layer.effectDiscard(Effect.forkScoped(loop))
