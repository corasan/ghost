import {
  type ChatUsage,
  type ContextFill,
  PlanLimit,
  type TokenUsage,
  type UsageRange,
  UsageReport,
  type UsageSource,
} from '@ghost/contract'
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { startOfDay } from '../activity/activity.ts'
import { addUsage, mergeLimits, noUsage } from '../agent/usage.ts'
import { Settings } from './settings.ts'

export interface UsageEntry {
  readonly source: UsageSource
  readonly jobId: string | null
  readonly sessionId: string | null
  readonly conversation: string | null
  readonly model: string
  readonly usage: TokenUsage
  readonly context: ContextFill | null
}

export interface LedgerRow {
  readonly source: UsageSource
  readonly session_id: string | null
  readonly title: string | null
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_tokens: number
  readonly cache_write_tokens: number
  readonly cost_usd: number
  readonly context_tokens: number | null
  readonly context_window: number | null
  readonly created_at: string
}

export interface SeenLimits {
  readonly limits: ReadonlyArray<PlanLimit>
  readonly seenAt: string | null
}

export interface UsageRepoService {
  readonly record: (entry: UsageEntry) => Effect.Effect<void, SqlError.SqlError>
  /** What earlier calls in this agent conversation already recorded. */
  readonly baseline: (conversation: string) => Effect.Effect<TokenUsage, SqlError.SqlError>
  readonly noteLimits: (limits: ReadonlyArray<PlanLimit>) => Effect.Effect<void, SqlError.SqlError>
  readonly report: (
    range: UsageRange,
    timeZone?: string,
  ) => Effect.Effect<UsageReport, SqlError.SqlError>
}

export class UsageRepo extends Context.Service<UsageRepo, UsageRepoService>()('UsageRepo') {}

const LIMITS_KEY = 'usage.limits'
const LimitsJson = Schema.fromJsonString(
  Schema.Struct({ limits: Schema.Array(PlanLimit), seenAt: Schema.String }),
)
const decodeLimits = Schema.decodeUnknownOption(LimitsJson)
const encodeLimits = Schema.encodeEffect(LimitsJson)

const HOUR_MS = 60 * 60 * 1000
const DAYS: Record<UsageRange, number> = { day: 1, week: 7, month: 30 }

/** The 24h range rolls; longer ranges start at midnight so every bar is a whole day. */
export const rangeStart = (range: UsageRange, nowMs: number, timeZone?: string) =>
  range === 'day'
    ? new Date(nowMs - 24 * HOUR_MS).toISOString()
    : startOfDay(nowMs - (DAYS[range] - 1) * 24 * HOUR_MS, timeZone)

const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const dayOf = (ms: number, timeZone?: string) =>
  DateTime.formatIsoDate(
    Option.getOrElse(DateTime.makeZoned(ms, { timeZone: timeZone ?? serverZone }), () =>
      DateTime.makeZonedUnsafe(ms, { timeZone: serverZone }),
    ),
  )

const rowUsage = (row: LedgerRow): TokenUsage => ({
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  cacheReadTokens: row.cache_read_tokens,
  cacheWriteTokens: row.cache_write_tokens,
  costUsd: row.cost_usd,
})

const rowContext = (row: LedgerRow): ContextFill | null =>
  row.context_tokens === null || row.context_window === null
    ? null
    : { tokens: row.context_tokens, window: row.context_window }

/** A window whose reset has passed has started over since Claude last reported it. */
const current = (limits: ReadonlyArray<PlanLimit>, nowMs: number) =>
  limits.map((limit) =>
    limit.resetsAt !== null && Date.parse(limit.resetsAt) <= nowMs
      ? { ...limit, utilization: 0, resetsAt: null }
      : limit,
  )

interface Bucket {
  usage: TokenUsage
  runs: number
}

const tallyInto = <K>(buckets: Map<K, Bucket>, key: K, usage: TokenUsage) => {
  const bucket = buckets.get(key) ?? { usage: noUsage, runs: 0 }
  buckets.set(key, { usage: addUsage(bucket.usage, usage), runs: bucket.runs + 1 })
}

export const buildReport = (
  range: UsageRange,
  rows: ReadonlyArray<LedgerRow>,
  seen: SeenLimits,
  nowMs: number,
  timeZone?: string,
): UsageReport => {
  const start = Date.parse(rangeStart(range, nowMs, timeZone))
  const hours = Array.from(
    { length: Math.floor((nowMs - start) / HOUR_MS) + 1 },
    (_, hour) => start + hour * HOUR_MS,
  )
  const days = new Map<string, Bucket>(
    [...hours, nowMs].map((ms) => [dayOf(ms, timeZone), { usage: noUsage, runs: 0 }]),
  )
  const sources = new Map<UsageSource, Bucket>()
  const chats = new Map<string, ChatUsage>()
  let total = noUsage
  for (const row of rows) {
    const usage = rowUsage(row)
    total = addUsage(total, usage)
    tallyInto(days, dayOf(Date.parse(row.created_at), timeZone), usage)
    tallyInto(sources, row.source, usage)
    if (row.source !== 'chat' || row.session_id === null) continue
    const chat = chats.get(row.session_id)
    chats.set(row.session_id, {
      sessionId: row.session_id,
      title: row.title ?? '',
      lastAt: row.created_at,
      runs: (chat?.runs ?? 0) + 1,
      usage: addUsage(chat?.usage ?? noUsage, usage),
      context: rowContext(row),
    })
  }
  return new UsageReport({
    range,
    total,
    runs: rows.length,
    byDay: [...days]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({ date, ...bucket })),
    bySource: [...sources]
      .map(([source, bucket]) => ({ source, ...bucket }))
      .toSorted((a, b) => b.usage.costUsd - a.usage.costUsd),
    chats: [...chats.values()].toSorted((a, b) => b.usage.costUsd - a.usage.costUsd),
    limits: current(seen.limits, nowMs),
    limitsSeenAt: seen.seenAt,
  })
}

export const UsageRepoLive = Layer.effect(
  UsageRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const settings = yield* Settings

    const record = (entry: UsageEntry) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO usage_runs (
            id, source, job_id, session_id, conversation, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
            context_tokens, context_window, created_at
          ) VALUES (
            ${crypto.randomUUID()}, ${entry.source}, ${entry.jobId}, ${entry.sessionId},
            ${entry.conversation}, ${entry.model},
            ${entry.usage.inputTokens}, ${entry.usage.outputTokens},
            ${entry.usage.cacheReadTokens}, ${entry.usage.cacheWriteTokens}, ${entry.usage.costUsd},
            ${entry.context?.tokens ?? null}, ${entry.context?.window ?? null}, ${now}
          )
        `
      })

    const baseline = (conversation: string) =>
      sql<{
        readonly input_tokens: number
        readonly output_tokens: number
        readonly cache_read_tokens: number
        readonly cache_write_tokens: number
        readonly cost_usd: number
      }>`
        SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
               COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM usage_runs WHERE conversation = ${conversation}
      `.pipe(
        Effect.map(([row]) =>
          row === undefined
            ? noUsage
            : {
                inputTokens: row.input_tokens,
                outputTokens: row.output_tokens,
                cacheReadTokens: row.cache_read_tokens,
                cacheWriteTokens: row.cache_write_tokens,
                costUsd: row.cost_usd,
              },
        ),
      )

    const seenLimits = settings.get(LIMITS_KEY).pipe(
      Effect.map((stored) =>
        Option.match(Option.flatMap(stored, decodeLimits), {
          onNone: (): SeenLimits => ({ limits: [], seenAt: null }),
          onSome: (seen): SeenLimits => seen,
        }),
      ),
    )

    const noteLimits = (limits: ReadonlyArray<PlanLimit>) =>
      Effect.gen(function* () {
        if (limits.length === 0) return
        const seen = yield* seenLimits
        const seenAt = DateTime.formatIso(yield* DateTime.now)
        const json = yield* encodeLimits({ limits: mergeLimits(seen.limits, limits), seenAt }).pipe(
          Effect.orDie,
        )
        yield* settings.set(LIMITS_KEY, json)
      })

    const report = (range: UsageRange, timeZone?: string) =>
      Effect.gen(function* () {
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now)
        const rows = yield* sql<LedgerRow>`
          SELECT source, session_id, input_tokens, output_tokens, cache_read_tokens,
                 cache_write_tokens, cost_usd, context_tokens, context_window, created_at,
                 (SELECT prompt FROM jobs
                  WHERE jobs.session_id = usage_runs.session_id
                  ORDER BY created_at ASC LIMIT 1) AS title
          FROM usage_runs
          WHERE created_at >= ${rangeStart(range, nowMs, timeZone)}
          ORDER BY created_at ASC
        `
        return buildReport(range, rows, yield* seenLimits, nowMs, timeZone)
      })

    return { record, baseline, noteLimits, report }
  }),
)
