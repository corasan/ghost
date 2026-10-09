import { Effect, Layer, Option } from 'effect'
import { JobsRepo } from '../db/jobs.ts'
import { Settings } from '../db/settings.ts'
import { type AgentFailed, type AgentRequest, ClaudeAgent } from './claude.ts'
import { CurrentJob } from './current-job.ts'

// One daemon fiber drains the queue. Polling SQLite every two seconds is
// deliberately boring: a job row is the unit of work, so a crash mid-run
// leaves it in `running` and a restart can be told to retry, and the mobile
// app only ever reads rows. One job at a time also avoids two agents racing
// to move the same items.
const conversationKey = (sessionId: string) => `agent.conversation.${sessionId}`

const tick = Effect.gen(function* () {
  const jobs = yield* JobsRepo
  const agent = yield* ClaudeAgent
  const current = yield* CurrentJob
  const settings = yield* Settings
  const next = yield* jobs.nextQueued
  if (Option.isNone(next)) return
  const job = next.value
  yield* jobs.setStatus(job.id, 'running')
  yield* Effect.logInfo(`job ${job.id} (${job.kind}) started`)
  const resume =
    job.sessionId === null
      ? null
      : Option.getOrNull(yield* settings.get(conversationKey(job.sessionId)))
  const request: AgentRequest = {
    kind: job.kind,
    prompt: job.prompt,
    characterId: job.characterId,
    resume,
    onStep: (step) => {
      Effect.runFork(Effect.ignore(jobs.addStep(job.id, step)))
    },
  }
  // A conversation that cannot be resumed gets one fresh run, unless the
  // failed run already presented a plan: a second run would present another.
  const retryFresh = (error: AgentFailed) =>
    resume === null
      ? Effect.fail(error)
      : jobs.get(job.id).pipe(
          Effect.matchEffect({
            onFailure: () => Effect.fail(error),
            onSuccess: (latest) =>
              latest.plan === null ? agent.run({ ...request, resume: null }) : Effect.fail(error),
          }),
        )
  const outcome = yield* agent
    .run(request)
    .pipe(
      Effect.catch(retryFresh),
      current.around({ id: job.id, characterId: job.characterId }),
      Effect.result,
    )
  if (outcome._tag === 'Success') {
    const { text, conversation } = outcome.success
    if (job.sessionId !== null && conversation !== null) {
      yield* settings.set(conversationKey(job.sessionId), conversation)
    }
    yield* jobs.setStatus(job.id, 'done', { result: text })
    yield* Effect.logInfo(`job ${job.id} done`)
  } else {
    yield* jobs.setStatus(job.id, 'failed', { error: outcome.failure.message })
    yield* Effect.logWarning(`job ${job.id} failed: ${outcome.failure.message}`)
  }
})

const loop = tick.pipe(
  Effect.catchCause((cause) => Effect.logError('job runner tick failed', cause)),
  Effect.delay('2 seconds'),
  Effect.forever,
)

const start = Effect.flatMap(JobsRepo, (jobs) => jobs.failInterrupted).pipe(
  Effect.catchCause((cause) => Effect.logError('could not clear interrupted jobs', cause)),
  Effect.andThen(loop),
)

export const JobRunnerLive = Layer.effectDiscard(Effect.forkScoped(start))
