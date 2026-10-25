import type { ContextFill, PlanLimit, TokenUsage, UsageSource } from '@ghost/contract'

export const totalTokens = (usage: TokenUsage) =>
  usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens

export const contextShare = (context: ContextFill) =>
  context.window === 0 ? 0 : context.tokens / context.window

export const fiveHour = (limits: ReadonlyArray<PlanLimit>) =>
  limits.find((limit) => limit.window === 'five_hour')

export const limitLabel = (window: string) => window.replaceAll('_', ' ').toUpperCase()

export const SOURCE_LABELS: Record<UsageSource, string> = {
  chat: 'Chats',
  summary: 'Creator video notes',
  situational: 'Conditional bonus write-ups',
}
