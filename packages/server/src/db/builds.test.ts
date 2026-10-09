import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Plan } from '@ghost/contract'
import { Effect, Layer, Option, Redacted } from 'effect'
import { AppConfig } from '../config.ts'
import type { BuildRecipe } from '../plans/recipe.ts'
import { BuildsRepo, BuildsRepoLive } from './builds.ts'
import { DatabaseLive } from './client.ts'

const dataDir = mkdtempSync(join(tmpdir(), 'ghost-builds-'))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const ConfigTest = Layer.succeed(AppConfig, {
  host: '127.0.0.1',
  port: 0,
  dataDir,
  model: 'test',
  effort: 'low',
  claudePath: '',
  youtubeChannels: '',
  bungie: { apiKey: Redacted.make(''), clientId: '', clientSecret: Redacted.make('') },
  jev: { apiKey: Redacted.make(''), model: 'test' },
})

const BuildsTest = BuildsRepoLive.pipe(Layer.provideMerge(DatabaseLive), Layer.provide(ConfigTest))

const recipe: BuildRecipe = {
  kind: 'build',
  title: 'BUILD PLAN',
  confirmLabel: 'APPLY BUILD',
  rows: [{ itemInstanceId: 'helm', action: 'equip' }],
  purpose: 'Void Titan melee',
  characterId: 'titan',
}

const plan = new Plan({
  kind: 'build',
  title: 'BUILD PLAN',
  subtitle: 'Sentinel melee loop',
  stats: [],
  featured: null,
  rows: [],
  note: null,
  confirmLabel: 'APPLY BUILD',
  status: 'proposed',
})

const run = <A, E>(effect: Effect.Effect<A, E, BuildsRepo>) =>
  effect.pipe(Effect.provide(BuildsTest), Effect.runPromise)

test('a build round-trips with its recipe and is found by the job that made it', async () => {
  const [saved, found] = await run(
    Effect.gen(function* () {
      const builds = yield* BuildsRepo
      const saved = yield* builds.insert({ jobId: 'job-1', name: 'Melee', recipe, plan })
      return [saved, yield* builds.byJob('job-1')] as const
    }),
  )
  expect(saved.recipe).toEqual(recipe)
  expect(saved.plan).toEqual(plan)
  expect(saved.inGame).toBeNull()
  expect(Option.getOrNull(found)?.id).toBe(saved.id)
})

test('claiming a slot takes it away from the build that held it', async () => {
  const [first, second] = await run(
    Effect.gen(function* () {
      const builds = yield* BuildsRepo
      const a = yield* builds.insert({ jobId: 'job-a', name: 'A', recipe, plan })
      const b = yield* builds.insert({ jobId: 'job-b', name: 'B', recipe, plan })
      yield* builds.claimInGameSlot(a.id, { characterId: 'titan', index: 3 })
      yield* builds.claimInGameSlot(b.id, { characterId: 'titan', index: 3 })
      return [yield* builds.get(a.id), yield* builds.get(b.id)] as const
    }),
  )
  expect(first.inGame).toBeNull()
  expect(second.inGame?.characterId).toBe('titan')
  expect(second.inGame?.index).toBe(3)
})

test('renaming an unknown build is BuildNotFound', async () => {
  const result = await run(
    Effect.flatMap(BuildsRepo, (builds) => builds.rename('nope', 'X')).pipe(Effect.result),
  )
  expect(result._tag === 'Failure' && result.failure._tag).toBe('BuildNotFound')
})
