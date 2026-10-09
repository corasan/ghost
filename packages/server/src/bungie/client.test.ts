import { describe, expect, test } from 'bun:test'
import { Effect, Exit, Fiber, Layer, Option, Redacted } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { TestClock } from 'effect/testing'
import { AppConfig } from '../config.ts'
import { Settings } from '../db/settings.ts'
import {
  BungieClient,
  BungieClientLive,
  BungieError,
  isRetryable,
  MEMBERSHIP_KEY,
} from './client.ts'

const config = Layer.succeed(AppConfig, {
  host: '127.0.0.1',
  port: 0,
  dataDir: '',
  model: 'test',
  effort: 'low',
  claudePath: '',
  youtubeChannels: '',
  bungie: { apiKey: Redacted.make('key'), clientId: '123', clientSecret: Redacted.make('secret') },
  jev: { apiKey: Redacted.make(''), model: 'test' },
})

const later = '2100-01-01T00:00:00.000Z'
const earlier = '2000-01-01T00:00:00.000Z'

const tokens = (fields: { expiresAt: string; refreshExpiresAt?: string }) =>
  JSON.stringify({
    accessToken: 'access',
    refreshToken: 'refresh',
    membershipId: '1',
    ...fields,
  })

const envelope = (ErrorCode: number, extra: Record<string, number | string> = {}) =>
  Response.json({ ErrorCode, ErrorStatus: `Code${ErrorCode}`, Message: 'm', ...extra })

/**
 * A BungieClient over an in-memory settings table and a fake `fetch` that
 * answers each request with the next of `replies`, recording the URLs asked.
 */
const harness = (stored: Record<string, string>, replies: ReadonlyArray<() => Response>) => {
  const store = new Map(Object.entries(stored))
  const calls: Array<string> = []
  const settings = Layer.succeed(Settings, {
    get: (key) => Effect.sync(() => Option.fromNullishOr(store.get(key))),
    set: (key, value) => Effect.sync(() => void store.set(key, value)),
    remove: (key) => Effect.sync(() => void store.delete(key)),
  })
  const fetch = Object.assign(
    async (input: string | URL | Request) => {
      calls.push(String(input instanceof Request ? input.url : input))
      const reply = replies[calls.length - 1]
      if (reply === undefined) throw new Error('connection reset')
      return reply()
    },
    { preconnect: () => {} },
  )
  const run = <A, E>(use: (client: BungieClient['Service']) => Effect.Effect<A, E>) =>
    Effect.flatMap(BungieClient, use).pipe(
      Effect.provide(BungieClientLive.pipe(Layer.provide(Layer.merge(config, settings)))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    )
  return { store, calls, run }
}

const failure = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined

describe('BungieClient envelopes', () => {
  test("an error code fails with Bungie's code and is not retried when it is not transient", async () => {
    const { calls, run } = harness({ 'bungie.tokens': tokens({ expiresAt: later }) }, [
      () => envelope(5, { ThrottleSeconds: 0 }),
    ])
    const exit = await Effect.runPromise(Effect.exit(run((c) => c.get('/Destiny2/x/'))))
    const error = failure(exit)
    expect(error).toBeInstanceOf(BungieError)
    expect(error).toMatchObject({ status: 'Code5', errorCode: 5 })
    expect(calls).toHaveLength(1)
  })

  test('a throttled read waits and tries again', async () => {
    const { calls, run } = harness({ 'bungie.tokens': tokens({ expiresAt: later }) }, [
      () => envelope(1672, { ThrottleSeconds: 2 }),
      () => envelope(1, { Response: 'ok' }),
    ])
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(run((c) => c.get('/Destiny2/x/')))
        yield* TestClock.adjust('1 second')
        // Bungie asked for two seconds, longer than the first backoff step.
        expect(calls).toHaveLength(1)
        yield* TestClock.adjust('1 second')
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(result).toBe('ok')
    expect(calls).toHaveLength(2)
  })

  test('an action is not sent again after a dropped connection', async () => {
    const { calls, run } = harness({ 'bungie.tokens': tokens({ expiresAt: later }) }, [])
    const exit = await Effect.runPromise(
      Effect.exit(run((c) => c.equipItem({ itemId: '1', characterId: '2', membershipType: 3 }))),
    )
    expect(failure(exit)).toMatchObject({ status: 'Transport' })
    expect(calls).toHaveLength(1)
  })
})

describe('isRetryable', () => {
  const error = (fields: { status: string; errorCode?: number }) =>
    new BungieError({ message: 'm', ...fields })

  test('throttles are retried for actions too, transient failures only for reads', () => {
    expect(isRetryable(error({ status: 'x', errorCode: 36 }), false)).toBe(true)
    expect(isRetryable(error({ status: 'x', errorCode: 51 }), false)).toBe(true)
    expect(isRetryable(error({ status: 'Transport' }), false)).toBe(false)
    expect(isRetryable(error({ status: 'Transport' }), true)).toBe(true)
    expect(isRetryable(error({ status: 'x', errorCode: 1652 }), true)).toBe(true)
    expect(isRetryable(error({ status: 'x', errorCode: 1652 }), false)).toBe(false)
    expect(isRetryable(error({ status: 'x', errorCode: 1623 }), true)).toBe(false)
  })
})

describe('BungieClient tokens', () => {
  test('a refused refresh forgets the tokens and reads as not linked', async () => {
    const { store, run } = harness(
      { 'bungie.tokens': tokens({ expiresAt: earlier }), [MEMBERSHIP_KEY]: '{}' },
      [() => Response.json({ error: 'invalid_grant' }, { status: 400 })],
    )
    const exit = await Effect.runPromise(Effect.exit(run((c) => c.get('/Destiny2/x/'))))
    expect(failure(exit)).toMatchObject({ _tag: 'BungieNotLinked' })
    expect(store.has('bungie.tokens')).toBe(false)
    expect(store.has(MEMBERSHIP_KEY)).toBe(false)
    expect(await Effect.runPromise(run((c) => c.isLinked))).toBe(false)
  })

  test('an expired refresh token is not sent at all', async () => {
    const { calls, run } = harness(
      { 'bungie.tokens': tokens({ expiresAt: earlier, refreshExpiresAt: earlier }) },
      [],
    )
    const exit = await Effect.runPromise(Effect.exit(run((c) => c.get('/Destiny2/x/'))))
    expect(failure(exit)).toMatchObject({ _tag: 'BungieNotLinked' })
    expect(calls).toHaveLength(0)
  })

  test('a revoked grant on a Platform call signs out', async () => {
    const { store, run } = harness({ 'bungie.tokens': tokens({ expiresAt: later }) }, [
      () =>
        Response.json(
          { ErrorCode: 99, ErrorStatus: 'WebAuthRequired', Message: 'm' },
          { status: 401 },
        ),
    ])
    const exit = await Effect.runPromise(Effect.exit(run((c) => c.get('/Destiny2/x/'))))
    expect(failure(exit)).toMatchObject({ _tag: 'BungieNotLinked' })
    expect(store.has('bungie.tokens')).toBe(false)
  })

  test('requests that find the token expired together refresh it once', async () => {
    const refreshed = () =>
      Response.json({
        access_token: 'new',
        refresh_token: 'refresh2',
        expires_in: 3600,
        refresh_expires_in: 7_776_000,
        membership_id: '1',
      })
    const { calls, store, run } = harness({ 'bungie.tokens': tokens({ expiresAt: earlier }) }, [
      refreshed,
      () => envelope(1, { Response: 'a' }),
      () => envelope(1, { Response: 'b' }),
    ])
    await Effect.runPromise(
      run((c) => Effect.all([c.get('/a/'), c.get('/b/')], { concurrency: 'unbounded' })),
    )
    expect(calls.filter((url) => url.includes('/oauth/token/'))).toHaveLength(1)
    expect(JSON.parse(store.get('bungie.tokens') ?? '{}')).toMatchObject({
      accessToken: 'new',
      refreshToken: 'refresh2',
    })
    expect(JSON.parse(store.get('bungie.tokens') ?? '{}').refreshExpiresAt).toBeString()
  })
})

describe('BungieClient sign-in', () => {
  const granted = () =>
    Response.json({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      membership_id: '2',
    })

  test('a code only counts with the state Ghost handed out, once', async () => {
    const { store, run } = harness({ [MEMBERSHIP_KEY]: '{}' }, [granted, granted])
    const outcome = await Effect.runPromise(
      run((c) =>
        Effect.gen(function* () {
          const url = new URL(yield* c.authorizeUrl)
          const state = url.searchParams.get('state') ?? ''
          const forged = yield* Effect.exit(c.exchangeCode('code', 'forged'))
          const first = yield* Effect.exit(c.exchangeCode('code', state))
          const replay = yield* Effect.exit(c.exchangeCode('code', state))
          return { state, forged, first, replay }
        }),
      ),
    )
    expect(outcome.state).toMatch(/^[0-9a-f]{32}$/)
    expect(failure(outcome.forged)).toMatchObject({ status: 'State' })
    expect(Exit.isSuccess(outcome.first)).toBe(true)
    expect(failure(outcome.replay)).toMatchObject({ status: 'State' })
    // The old account's membership must not be read with the new tokens.
    expect(store.has(MEMBERSHIP_KEY)).toBe(false)
  })
})
