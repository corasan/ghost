import { Context, Effect, Layer, Option, Ref } from "effect"

// The MCP tools run in a separate request from the agent run, so they learn
// which job a plan belongs to from here. The runner sets it around each run;
// one job runs at a time, so a single slot is enough.

export interface CurrentJobInfo {
  readonly id: string
  readonly characterId: string | null
}

export interface CurrentJobService {
  readonly get: Effect.Effect<Option.Option<CurrentJobInfo>>
  readonly around: (
    job: CurrentJobInfo,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class CurrentJob extends Context.Service<CurrentJob, CurrentJobService>()("CurrentJob") {}

export const CurrentJobLive = Layer.effect(
  CurrentJob,
  Effect.gen(function* () {
    const ref = yield* Ref.make<Option.Option<CurrentJobInfo>>(Option.none())
    return {
      get: Ref.get(ref),
      around: (job) => (effect) =>
        Ref.set(ref, Option.some(job)).pipe(
          Effect.andThen(effect),
          Effect.ensuring(Ref.set(ref, Option.none())),
        ),
    }
  }),
)
