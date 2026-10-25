import type { ModelUsage, SDKMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ContextFill, PlanLimit, TokenUsage } from '@ghost/contract'
import { Option, Schema } from 'effect'

/**
 * What one Claude call reported. On a resumed conversation Claude Code reports
 * totals for the whole conversation so far, not for this call alone.
 */
export interface RunUsage {
  readonly model: string
  readonly totals: TokenUsage
  readonly context: ContextFill | null
}

type ResultMessage = {
  readonly type: 'result'
  readonly total_cost_usd: number
  readonly modelUsage: Readonly<
    Record<
      string,
      Pick<
        ModelUsage,
        | 'inputTokens'
        | 'outputTokens'
        | 'cacheReadInputTokens'
        | 'cacheCreationInputTokens'
        | 'costUSD'
        | 'contextWindow'
      >
    >
  >
}

export type UsageMessage =
  | {
      readonly type: 'assistant'
      readonly parent_tool_use_id: string | null
      readonly message: {
        readonly model: string
        readonly usage: {
          readonly input_tokens: number
          readonly cache_read_input_tokens: number | null
          readonly cache_creation_input_tokens: number | null
        }
      }
    }
  | ResultMessage
  | { readonly type: 'rate_limit_event'; readonly rate_limit_info: SDKRateLimitInfo }
  | { readonly type: Exclude<SDKMessage['type'], 'assistant' | 'result' | 'rate_limit_event'> }

interface Turn {
  readonly model: string
  readonly tokens: number
}

export interface Tally {
  readonly lastTurn: Turn | null
  readonly usage: RunUsage | null
  readonly limits: ReadonlyArray<PlanLimit>
}

export const emptyTally: Tally = { lastTurn: null, usage: null, limits: [] }

export const noUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
}

const FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'costUsd',
] as const satisfies ReadonlyArray<keyof TokenUsage>

const COST_TOLERANCE = 1e-6

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  costUsd: a.costUsd + b.costUsd,
})

/**
 * The share of `cumulative` spent after `baseline` was recorded. A transcript
 * that did not carry its totals restarts below the baseline, and then the
 * whole of `cumulative` is this call's own.
 */
export const since = (cumulative: TokenUsage, baseline: TokenUsage): TokenUsage =>
  FIELDS.some((field) => cumulative[field] + COST_TOLERANCE < baseline[field])
    ? cumulative
    : {
        inputTokens: cumulative.inputTokens - baseline.inputTokens,
        outputTokens: cumulative.outputTokens - baseline.outputTokens,
        cacheReadTokens: cumulative.cacheReadTokens - baseline.cacheReadTokens,
        cacheWriteTokens: cumulative.cacheWriteTokens - baseline.cacheWriteTokens,
        costUsd: Math.max(0, cumulative.costUsd - baseline.costUsd),
      }

const LimitWindow = Schema.Struct({
  utilization: Schema.optional(Schema.Number),
  resetsAt: Schema.optional(Schema.Number),
  status: Schema.optional(Schema.String),
})

const RateLimitInfo = Schema.Struct({
  status: Schema.String,
  resetsAt: Schema.optional(Schema.Number),
  rateLimitType: Schema.optional(Schema.String),
  utilization: Schema.optional(Schema.Number),
  unifiedWindows: Schema.optional(Schema.Record(Schema.String, LimitWindow)),
})

const decodeRateLimitInfo = Schema.decodeUnknownOption(RateLimitInfo)

const isoFromUnix = (seconds: number | undefined) =>
  seconds === undefined ? null : new Date(seconds * 1000).toISOString()

/**
 * The plan meters in a rate_limit_event. Claude Code sends every window in
 * `unifiedWindows`, which its types do not declare; older ones only name the
 * window the status is about.
 */
export const decodeLimits = (info: SDKRateLimitInfo): ReadonlyArray<PlanLimit> =>
  Option.match(decodeRateLimitInfo(info), {
    onNone: () => [],
    onSome: ({ status, resetsAt, rateLimitType, utilization, unifiedWindows }) =>
      unifiedWindows !== undefined
        ? Object.entries(unifiedWindows).flatMap(([window, meter]) =>
            meter.utilization === undefined
              ? []
              : [
                  {
                    window,
                    utilization: meter.utilization,
                    resetsAt: isoFromUnix(meter.resetsAt),
                    status: meter.status ?? status,
                  },
                ],
          )
        : rateLimitType === undefined || utilization === undefined
          ? []
          : [{ window: rateLimitType, utilization, resetsAt: isoFromUnix(resetsAt), status }],
  })

export const mergeLimits = (
  older: ReadonlyArray<PlanLimit>,
  newer: ReadonlyArray<PlanLimit>,
): ReadonlyArray<PlanLimit> => [
  ...older.filter((limit) => !newer.some((next) => next.window === limit.window)),
  ...newer,
]

const resultUsage = (result: ResultMessage, lastTurn: Turn | null): RunUsage => {
  const models = Object.entries(result.modelUsage)
  const tokens = models.reduce<TokenUsage>(
    (sum, [, model]) =>
      addUsage(sum, {
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheReadTokens: model.cacheReadInputTokens,
        cacheWriteTokens: model.cacheCreationInputTokens,
        costUsd: 0,
      }),
    noUsage,
  )
  const priciest = models.toSorted(([, a], [, b]) => b.costUSD - a.costUSD)[0]?.[0]
  const window = lastTurn === null ? undefined : result.modelUsage[lastTurn.model]?.contextWindow
  return {
    model: lastTurn?.model ?? priciest ?? 'unknown',
    totals: { ...tokens, costUsd: result.total_cost_usd },
    context: lastTurn === null || window === undefined ? null : { tokens: lastTurn.tokens, window },
  }
}

/**
 * Folds one SDK message into the tally. The context fill is the prompt size of
 * the last main-loop turn; subagent turns run in their own context.
 */
export const observe = (tally: Tally, message: UsageMessage): Tally => {
  switch (message.type) {
    case 'assistant': {
      if (message.parent_tool_use_id !== null) return tally
      const { model, usage } = message.message
      const tokens =
        usage.input_tokens +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      return { ...tally, lastTurn: { model, tokens } }
    }
    case 'result':
      return { ...tally, usage: resultUsage(message, tally.lastTurn) }
    case 'rate_limit_event':
      return { ...tally, limits: mergeLimits(tally.limits, decodeLimits(message.rate_limit_info)) }
    default:
      return tally
  }
}
