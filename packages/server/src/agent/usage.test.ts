import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'bun:test'
import { decodeLimits, emptyTally, observe, since, type UsageMessage } from './usage.ts'

const tokens = (cacheWriteTokens: number, costUsd: number) => ({
  inputTokens: 40,
  outputTokens: 900,
  cacheReadTokens: 120_000,
  cacheWriteTokens,
  costUsd,
})

describe('since', () => {
  test("keeps only what a resumed run added to its conversation's totals", () => {
    const delta = since(
      {
        inputTokens: 52,
        outputTokens: 1300,
        cacheReadTokens: 150_000,
        cacheWriteTokens: 448_345,
        costUsd: 0.47,
      },
      tokens(442_176, 0.442),
    )
    expect(delta).toEqual({
      inputTokens: 12,
      outputTokens: 400,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 6169,
      costUsd: expect.closeTo(0.028, 9),
    })
  })

  test('counts the whole report as the run’s own when the transcript lost its totals', () => {
    const fresh = { ...tokens(9000, 0.05), cacheReadTokens: 200_000 }
    expect(since(fresh, tokens(442_176, 0.442))).toEqual(fresh)
  })

  test('tolerates float drift in a summed baseline cost', () => {
    const baseline = tokens(1000, 0.1 + 0.2)
    expect(since(tokens(1000, 0.3), baseline).cacheWriteTokens).toBe(0)
  })
})

describe('decodeLimits', () => {
  test('reads every plan window Claude Code reports', () => {
    const info = {
      status: 'allowed',
      resetsAt: 1792908600,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: 0.06, resetsAt: 1792908600, status: 'allowed' },
        seven_day: { utilization: 0.59, resetsAt: 1792954800, status: 'allowed' },
      },
    } as const
    expect(decodeLimits(info)).toEqual([
      {
        window: 'five_hour',
        utilization: 0.06,
        resetsAt: '2026-10-25T06:10:00.000Z',
        status: 'allowed',
      },
      {
        window: 'seven_day',
        utilization: 0.59,
        resetsAt: '2026-10-25T19:00:00.000Z',
        status: 'allowed',
      },
    ])
  })

  test('falls back to the one window an older event names', () => {
    expect(
      decodeLimits({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.81 }),
    ).toEqual([
      { window: 'seven_day', utilization: 0.81, resetsAt: null, status: 'allowed_warning' },
    ])
  })

  test('has nothing to show for an event without a utilization', () => {
    expect(decodeLimits({ status: 'allowed', rateLimitType: 'five_hour' })).toEqual([])
  })
})

const assistant = (
  model: string,
  parent: string | null,
  input: number,
  cacheRead: number,
): UsageMessage => ({
  type: 'assistant',
  parent_tool_use_id: parent,
  message: {
    model,
    usage: {
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: 500,
    },
  },
})

const modelUsage = (inputTokens: number, costUSD: number, contextWindow: number) => ({
  inputTokens,
  outputTokens: 100,
  cacheReadInputTokens: 1000,
  cacheCreationInputTokens: 10,
  webSearchRequests: 0,
  costUSD,
  contextWindow,
  maxOutputTokens: 32_000,
})

const result: UsageMessage = {
  type: 'result',
  total_cost_usd: 0.9,
  modelUsage: {
    'claude-opus': modelUsage(300, 0.8, 200_000),
    'claude-haiku': modelUsage(50, 0.1, 100_000),
  },
}

describe('observe', () => {
  test('measures context from the last main-loop turn against that model’s window', () => {
    const tally = [
      assistant('claude-opus', null, 10, 30_000),
      assistant('claude-opus', null, 12, 41_000),
      assistant('claude-haiku', 'tool-1', 5, 2000),
      result,
    ].reduce(observe, emptyTally)
    expect(tally.usage).toEqual({
      model: 'claude-opus',
      totals: {
        inputTokens: 350,
        outputTokens: 200,
        cacheReadTokens: 2000,
        cacheWriteTokens: 20,
        costUsd: 0.9,
      },
      context: { tokens: 41_512, window: 200_000 },
    })
  })

  test('books a run that never streamed a turn under its priciest model', () => {
    const tally = observe(emptyTally, result)
    expect(tally.usage?.model).toBe('claude-opus')
    expect(tally.usage?.context).toBeNull()
  })

  test('keeps windows a later rate limit event does not mention', () => {
    const event = (rate_limit_info: SDKRateLimitInfo): UsageMessage => ({
      type: 'rate_limit_event',
      rate_limit_info,
    })
    const tally = [
      event({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1 }),
      event({ status: 'allowed', rateLimitType: 'seven_day', utilization: 0.5 }),
      event({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.2 }),
    ].reduce(observe, emptyTally)
    expect(tally.limits.map(({ window, utilization }) => [window, utilization])).toEqual([
      ['seven_day', 0.5],
      ['five_hour', 0.2],
    ])
  })
})
