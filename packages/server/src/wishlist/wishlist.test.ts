import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Redacted } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { AppConfig } from '../config.ts'
import { DatabaseLive } from '../db/client.ts'
import { Settings, SettingsLive } from '../db/settings.ts'
import { Wishlist, WishlistLive } from './wishlist.ts'

const dataDir = mkdtempSync(join(tmpdir(), 'ghost-wishlist-'))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

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

const layer = WishlistLive.pipe(
  Layer.provideMerge(SettingsLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provide(config),
)

test('an ETag is only sent when there is a stored copy for it to describe', async () => {
  const sent: Array<string | null> = []
  const fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('if-none-match'))
      return sent.length === 1
        ? new Response('dimwishlist:item=100&perks=1,2\n', { headers: { etag: '"new"' } })
        : new Response(null, { status: 304 })
    },
    { preconnect: () => {} },
  )
  const rolls = await Effect.runPromise(
    Effect.gen(function* () {
      const settings = yield* Settings
      const wishlist = yield* Wishlist
      // An ETag left over from a copy that is no longer in the tables.
      yield* settings.set('wishlist.etag', '"old"')
      yield* wishlist.ensure
      yield* settings.set('wishlist.fetchedAt', '2000-01-01T00:00:00.000Z')
      yield* wishlist.ensure
      return yield* wishlist.rollsFor([100])
    }).pipe(Effect.provide(layer), Effect.provideService(FetchHttpClient.Fetch, fetch)),
  )
  expect(sent).toEqual([null, '"new"'])
  expect(rolls.get(100)?.map((roll) => roll.perkHashes)).toEqual([[1, 2]])
})
