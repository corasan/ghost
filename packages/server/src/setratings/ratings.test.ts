import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Redacted } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { AppConfig } from '../config.ts'
import { DatabaseLive } from '../db/client.ts'
import { Settings, SettingsLive } from '../db/settings.ts'
import { SetRatings, SetRatingsLive } from './ratings.ts'

const dirs: Array<string> = []
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

// A fresh database per test; the layer is built anew on every provide, so a
// second provide over the same directory is a server restart.
const freshLayer = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ghost-setratings-'))
  dirs.push(dataDir)
  const config = Layer.succeed(AppConfig, {
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
  return SetRatingsLive.pipe(
    Layer.provideMerge(SettingsLive),
    Layer.provideMerge(DatabaseLive),
    Layer.provide(config),
  )
}

const SHEET = [
  'INFO,,,,,,,,,ANALYSIS,,',
  '🖼️,#,Set,Season,Bonus,Pcs,Tags,Trigger,Effect,Description,#,Tier',
  `,,"Atheon's Memory
Vault of Glass",29,Collective Power,4,damage,5 damage instances with subclass buff active,Orb of Power at feet,great for extra super,1,S`,
].join('\n')

const fakeFetch = (respond: () => Response) => {
  let calls = 0
  const fetch = Object.assign(
    async () => {
      calls++
      return respond()
    },
    { preconnect: () => {} },
  )
  return { fetch, calls: () => calls }
}

const expire = Effect.gen(function* () {
  yield* (yield* Settings).set('setRatings.fetchedAt', '2000-01-01T00:00:00.000Z')
})

test('the first read downloads and stores the sheet; a fresh copy is not downloaded again', async () => {
  const sheet = fakeFetch(() => new Response(SHEET))
  const [first, second] = await Effect.runPromise(
    Effect.gen(function* () {
      const ratings = yield* SetRatings
      return [yield* ratings.ratings, yield* ratings.ratings] as const
    }).pipe(
      Effect.provide(freshLayer()),
      Effect.provideService(FetchHttpClient.Fetch, sheet.fetch),
    ),
  )
  expect(first.error).toBeNull()
  expect(first.asOf).not.toBeNull()
  expect(first.byBonus.get('collective power')).toMatchObject({
    set: "Atheon's Memory",
    source: 'Vault of Glass',
    tier: 'S',
    rank: 1,
  })
  expect(second.byBonus.size).toBe(1)
  expect(sheet.calls()).toBe(1)
})

test('a failed or non-sheet refresh keeps serving the stored copy, across a restart', async () => {
  const layer = freshLayer()
  const good = fakeFetch(() => new Response(SHEET))
  const down = fakeFetch(() => new Response('', { status: 500 }))
  const signIn = fakeFetch(
    () => new Response('<!doctype html><html><body>Sign in</body></html>', { status: 200 }),
  )
  const read = (fetch: typeof good.fetch, stale: boolean) =>
    Effect.gen(function* () {
      if (stale) yield* expire
      return yield* (yield* SetRatings).ratings
    }).pipe(Effect.provide(layer), Effect.provideService(FetchHttpClient.Fetch, fetch))

  await Effect.runPromise(read(good.fetch, false))
  const afterOutage = await Effect.runPromise(read(down.fetch, true))
  const afterSignIn = await Effect.runPromise(read(signIn.fetch, true))
  const afterRestart = await Effect.runPromise(read(down.fetch, false))

  expect(down.calls()).toBe(2)
  expect(signIn.calls()).toBe(1)
  for (const snapshot of [afterOutage, afterSignIn, afterRestart]) {
    expect(snapshot.error).toBeNull()
    expect([...snapshot.byBonus.keys()]).toEqual(['collective power'])
  }
})

test('with no stored copy a failed download gives no ratings and the reason, not a failure', async () => {
  const signIn = fakeFetch(() => new Response('<html>Sign in</html>'))
  const snapshot = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* SetRatings).ratings
    }).pipe(
      Effect.provide(freshLayer()),
      Effect.provideService(FetchHttpClient.Fetch, signIn.fetch),
    ),
  )
  expect(snapshot.byBonus.size).toBe(0)
  expect(snapshot.asOf).toBeNull()
  expect(snapshot.error).toMatch(/header/)
})
