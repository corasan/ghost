import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Redacted } from 'effect'
import { AppConfig } from '../config.ts'
import { DatabaseLive } from './client.ts'
import { JobsRepo, JobsRepoLive } from './jobs.ts'
import { SettingsLive } from './settings.ts'
import { buildReport, type LedgerRow, UsageRepo, UsageRepoLive } from './usage.ts'

const dataDir = mkdtempSync(join(tmpdir(), 'ghost-usage-'))
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

const RepoTest = Layer.mergeAll(JobsRepoLive, UsageRepoLive.pipe(Layer.provide(SettingsLive))).pipe(
  Layer.provideMerge(DatabaseLive),
  Layer.provide(ConfigTest),
)

const spent = (cacheWriteTokens: number, costUsd: number) => ({
  inputTokens: 10,
  outputTokens: 200,
  cacheReadTokens: 5000,
  cacheWriteTokens,
  costUsd,
})

test('a chat carries what its runs spent and the context of its latest run', async () => {
  const [session, baseline] = await Effect.gen(function* () {
    const jobs = yield* JobsRepo
    const usage = yield* UsageRepo
    const job = yield* jobs.create({ kind: 'chat', prompt: 'what is a hand cannon' })
    const entry = {
      source: 'chat' as const,
      jobId: job.id,
      sessionId: job.sessionId,
      conversation: 'conversation-1',
      model: 'claude-opus',
    }
    yield* usage.record({
      ...entry,
      usage: spent(40_000, 0.4),
      context: { tokens: 40_000, window: 200_000 },
    })
    yield* usage.record({
      ...entry,
      usage: spent(6000, 0.03),
      context: { tokens: 46_000, window: 200_000 },
    })
    yield* usage.record({
      ...entry,
      source: 'summary',
      sessionId: null,
      conversation: null,
      usage: spent(1, 1),
      context: null,
    })
    const sessions = yield* jobs.sessions
    return [
      sessions.find((s) => s.id === job.sessionId),
      yield* usage.baseline('conversation-1'),
    ] as const
  }).pipe(Effect.provide(RepoTest), Effect.runPromise)
  expect(session?.usage).toEqual({
    ...spent(46_000, expect.closeTo(0.43, 9)),
    inputTokens: 20,
    outputTokens: 400,
    cacheReadTokens: 10_000,
  })
  expect(session?.context).toEqual({ tokens: 46_000, window: 200_000 })
  expect(baseline.cacheWriteTokens).toBe(46_000)
})

test('the latest plan meters are kept window by window', async () => {
  const report = await Effect.gen(function* () {
    const usage = yield* UsageRepo
    yield* usage.noteLimits([
      {
        window: 'five_hour',
        utilization: 0.1,
        resetsAt: '2099-01-01T00:00:00.000Z',
        status: 'allowed',
      },
      {
        window: 'seven_day',
        utilization: 0.5,
        resetsAt: '2099-01-01T00:00:00.000Z',
        status: 'allowed',
      },
    ])
    yield* usage.noteLimits([
      {
        window: 'five_hour',
        utilization: 0.3,
        resetsAt: '2099-01-01T00:00:00.000Z',
        status: 'allowed',
      },
    ])
    return yield* usage.report('day')
  }).pipe(Effect.provide(RepoTest), Effect.runPromise)
  expect(report.limits.map((l) => [l.window, l.utilization])).toEqual([
    ['seven_day', 0.5],
    ['five_hour', 0.3],
  ])
  expect(report.limitsSeenAt).not.toBeNull()
})

const row = (fields: Partial<LedgerRow> & Pick<LedgerRow, 'created_at'>): LedgerRow => ({
  source: 'chat',
  session_id: null,
  title: null,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_usd: 0,
  context_tokens: null,
  context_window: null,
  ...fields,
})

describe('buildReport', () => {
  const now = Date.parse('2026-10-08T03:30:00Z')
  const none = { limits: [], seenAt: null }

  test("buckets runs into the player's days, empty days included", () => {
    const report = buildReport(
      'week',
      [
        row({ created_at: '2026-10-02T12:00:00.000Z', cost_usd: 0.1 }),
        row({ created_at: '2026-10-08T01:00:00.000Z', cost_usd: 0.2 }),
        row({ created_at: '2026-10-08T03:00:00.000Z', cost_usd: 0.3 }),
      ],
      none,
      now,
      'America/Los_Angeles',
    )
    expect(report.byDay.map((d) => [d.date, d.runs])).toEqual([
      ['2026-10-01', 0],
      ['2026-10-02', 1],
      ['2026-10-03', 0],
      ['2026-10-04', 0],
      ['2026-10-05', 0],
      ['2026-10-06', 0],
      ['2026-10-07', 2],
    ])
  })

  test('ranks chats by cost and shows each one’s latest context', () => {
    const report = buildReport(
      'day',
      [
        row({
          created_at: '2026-10-08T01:00:00.000Z',
          session_id: 'a',
          title: 'A',
          cost_usd: 0.1,
          context_tokens: 9,
          context_window: 100,
        }),
        row({ created_at: '2026-10-08T02:00:00.000Z', session_id: 'b', title: 'B', cost_usd: 0.3 }),
        row({
          created_at: '2026-10-08T03:00:00.000Z',
          session_id: 'a',
          title: 'A',
          cost_usd: 0.1,
          context_tokens: 20,
          context_window: 100,
        }),
        row({ created_at: '2026-10-08T03:10:00.000Z', source: 'summary', cost_usd: 1 }),
      ],
      none,
      now,
    )
    expect(report.chats.map((c) => [c.sessionId, c.runs, c.context?.tokens ?? null])).toEqual([
      ['b', 1, null],
      ['a', 2, 20],
    ])
    expect(report.bySource.map((s) => [s.source, s.runs])).toEqual([
      ['summary', 1],
      ['chat', 3],
    ])
    expect(report.runs).toBe(4)
  })

  test('shows a plan window whose reset has passed as empty again', () => {
    const report = buildReport(
      'day',
      [],
      {
        limits: [
          {
            window: 'five_hour',
            utilization: 0.9,
            resetsAt: '2026-10-08T01:00:00.000Z',
            status: 'allowed',
          },
          {
            window: 'seven_day',
            utilization: 0.4,
            resetsAt: '2026-10-10T00:00:00.000Z',
            status: 'allowed',
          },
        ],
        seenAt: '2026-10-07T20:00:00.000Z',
      },
      now,
    )
    expect(report.limits.map((l) => [l.window, l.utilization, l.resetsAt])).toEqual([
      ['five_hour', 0, null],
      ['seven_day', 0.4, '2026-10-10T00:00:00.000Z'],
    ])
  })
})
