import { Database } from 'bun:sqlite'
import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Plan } from '@ghost/contract'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import { AppConfig } from '../config.ts'
import type { BuildRecipe } from '../plans/recipe.ts'
import { BuildsRepo, BuildsRepoLive } from './builds.ts'
import { DatabaseLive } from './client.ts'

const dataDir = mkdtempSync(join(tmpdir(), 'ghost-builds-'))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const config = {
  host: '127.0.0.1',
  port: 0,
  model: 'test',
  effort: 'low',
  claudePath: '',
  youtubeChannels: '',
  bungie: { apiKey: Redacted.make(''), clientId: '', clientSecret: Redacted.make('') },
  jev: { apiKey: Redacted.make(''), model: 'test' },
}

const ConfigTest = Layer.succeed(AppConfig, { ...config, dataDir })

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
  expect(saved.link).toBeNull()
  expect(saved.revision).toBe(1)
  expect(Option.getOrNull(found)?.id).toBe(saved.id)
})

const helmGear = { itemInstanceId: 'helm', plugItemHashes: [7, 8] }

test('claiming a slot takes it away from the build that held it', async () => {
  const [first, second] = await run(
    Effect.gen(function* () {
      const builds = yield* BuildsRepo
      const a = yield* builds.insert({ jobId: 'job-a', name: 'A', recipe, plan })
      const b = yield* builds.insert({ jobId: 'job-b', name: 'B', recipe, plan })
      yield* builds.claimInGameSlot(a.id, { characterId: 'titan', index: 3 }, [helmGear])
      yield* builds.claimInGameSlot(b.id, { characterId: 'titan', index: 3 }, null)
      return [yield* builds.get(a.id), yield* builds.get(b.id)] as const
    }),
  )
  expect(first.link).toBeNull()
  expect(second.link?.characterId).toBe('titan')
  expect(second.link?.index).toBe(3)
  expect(second.link?.snapshot).toBeNull()
})

test('a revision counts content edits, a rename does not, and a link agrees with the revision it was made at', async () => {
  const [renamed, revised, linked] = await run(
    Effect.gen(function* () {
      const builds = yield* BuildsRepo
      const saved = yield* builds.insert({ jobId: 'job-rev', name: 'A', recipe, plan })
      const renamed = yield* builds.rename(saved.id, 'B')
      const revised = yield* builds.revise(saved.id, {
        name: 'C',
        recipe: { ...recipe, purpose: 'Void Titan grenades' },
        plan,
      })
      const linked = yield* builds.claimInGameSlot(saved.id, { characterId: 'titan', index: 5 }, [
        helmGear,
      ])
      return [renamed, revised, linked] as const
    }),
  )
  expect(renamed.revision).toBe(1)
  expect([revised.name, revised.revision, revised.recipe.purpose]).toEqual([
    'C',
    2,
    'Void Titan grenades',
  ])
  expect(linked.link?.revision).toBe(2)
  expect(linked.link?.snapshot).toEqual([helmGear])
})

test('a pending link adopts a baseline once and keeps it after', async () => {
  const adopted = await run(
    Effect.gen(function* () {
      const builds = yield* BuildsRepo
      const saved = yield* builds.insert({ jobId: 'job-adopt', name: 'A', recipe, plan })
      yield* builds.claimInGameSlot(saved.id, { characterId: 'titan', index: 6 }, null)
      yield* builds.adoptBaseline(saved.id, [helmGear])
      yield* builds.adoptBaseline(saved.id, [{ itemInstanceId: 'other', plugItemHashes: [] }])
      return yield* builds.get(saved.id)
    }),
  )
  expect(adopted.link?.snapshot).toEqual([helmGear])
})

test('an unlinked build gives up its slot and takes no baseline', async () => {
  const unlinked = await run(
    Effect.gen(function* () {
      const builds = yield* BuildsRepo
      const saved = yield* builds.insert({ jobId: 'job-unlink', name: 'A', recipe, plan })
      yield* builds.claimInGameSlot(saved.id, { characterId: 'titan', index: 7 }, null)
      yield* builds.unlink(saved.id)
      yield* builds.adoptBaseline(saved.id, [helmGear])
      return yield* builds.get(saved.id)
    }),
  )
  expect(unlinked.link).toBeNull()
})

test('unlinking an unknown build is BuildNotFound', async () => {
  const result = await run(
    Effect.flatMap(BuildsRepo, (builds) => builds.unlink('nope')).pipe(Effect.result),
  )
  expect(result._tag === 'Failure' && result.failure._tag).toBe('BuildNotFound')
})

test('a slot saved before revisions is a link waiting for its baseline at revision 1', async () => {
  const legacyDir = mkdtempSync(join(tmpdir(), 'ghost-builds-legacy-'))
  const layer = (dir: string) =>
    BuildsRepoLive.pipe(
      Layer.provideMerge(DatabaseLive),
      Layer.provide(Layer.succeed(AppConfig, { ...config, dataDir: dir })),
    )
  try {
    await Effect.runPromise(Effect.provide(Effect.void, layer(legacyDir)))
    const db = new Database(join(legacyDir, 'ghost.sqlite'))
    db.run('DELETE FROM effect_sql_migrations WHERE migration_id = 16')
    for (const column of ['revision', 'in_game_revision', 'in_game_snapshot']) {
      db.run(`ALTER TABLE saved_builds DROP COLUMN ${column}`)
    }
    db.run(
      `INSERT INTO saved_builds (id, job_id, name, recipe, plan, in_game_character_id, in_game_index, in_game_saved_at, created_at, updated_at)
       VALUES ('old', 'job-old', 'Old', ?, ?, 'titan', 2, 'then', 'then', 'then')`,
      [JSON.stringify(recipe), JSON.stringify(Schema.encodeSync(Plan)(plan))],
    )
    db.close()
    const legacy = await Effect.runPromise(
      Effect.flatMap(BuildsRepo, (builds) => builds.get('old')).pipe(
        Effect.provide(layer(legacyDir)),
      ),
    )
    expect(legacy.revision).toBe(1)
    expect(legacy.link).toEqual({
      characterId: 'titan',
      index: 2,
      savedAt: 'then',
      revision: 1,
      snapshot: null,
    })
  } finally {
    rmSync(legacyDir, { recursive: true, force: true })
  }
})
