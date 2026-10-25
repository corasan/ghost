import type { ChatUsage, PlanLimit, TokenUsage, UsageDay, UsageRange } from '@ghost/contract'
import { LegendList } from '@legendapp/list/react-native'
import { router } from 'expo-router'
import { type ReactNode, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Body, Chip, Cond, Meta, Mono, PageHeader } from '@/components/ghost/ui'
import { FillBar, fillTone } from '@/components/usage/fill-bar'
import { Ghost, Gutter } from '@/constants/theme'
import { useUsage } from '@/lib/api'
import { age, clock, percent, tokens, until, usd } from '@/lib/format'
import { useBottomInset } from '@/lib/insets'
import { usePullRefresh } from '@/lib/refresh'
import { continueSession } from '@/lib/session'
import { contextShare, fiveHour, limitLabel, SOURCE_LABELS, totalTokens } from '@/lib/usage'

const RANGES: ReadonlyArray<{ value: UsageRange; label: string; caption: string }> = [
  { value: 'day', label: '24H', caption: 'Last 24 hours' },
  { value: 'week', label: '7D', caption: 'Last 7 days' },
  { value: 'month', label: '30D', caption: 'Last 30 days' },
]

const CHART_HEIGHT = 64

function Meter({ limit }: { limit: PlanLimit }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.between}>
        <Mono>{limitLabel(limit.window)}</Mono>
        <Cond size={18} color={fillTone(limit.utilization)}>
          {percent(limit.utilization)}
        </Cond>
      </View>
      <FillBar share={limit.utilization} height={6} />
      <Meta size={12}>
        {limit.resetsAt === null
          ? 'Reset since Ghost last checked'
          : `Resets ${until(limit.resetsAt)} · ${clock(limit.resetsAt)}`}
      </Meta>
    </View>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Mono size={10}>{label}</Mono>
      <Cond size={22}>{value}</Cond>
    </View>
  )
}

function Totals({ total, runs }: { total: TokenUsage; runs: number }) {
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row' }}>
        <Figure label="INPUT" value={tokens(total.inputTokens)} />
        <Figure label="OUTPUT" value={tokens(total.outputTokens)} />
        <Figure label="CACHE READ" value={tokens(total.cacheReadTokens)} />
        <Figure label="CACHE WRITE" value={tokens(total.cacheWriteTokens)} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Figure label="RUNS" value={String(runs)} />
        <Figure label="TOKENS" value={tokens(totalTokens(total))} />
        <View style={{ flex: 2, gap: 4 }}>
          <Mono size={10}>EST. COST</Mono>
          <Cond size={22} color={Ghost.gold}>
            {usd(total.costUsd)}
          </Cond>
        </View>
      </View>
      <Meta size={12}>
        What these runs would cost on the API. Your Claude subscription pays for them.
      </Meta>
    </View>
  )
}

const dayLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    weekday: 'narrow',
  })
}

function DayChart({ days }: { days: ReadonlyArray<UsageDay> }) {
  const peak = Math.max(...days.map((day) => day.usage.costUsd), 0)
  const labelled = days.length <= 7
  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.chart, { gap: days.length > 7 ? 2 : 6 }]}>
        {days.map((day) => (
          <View
            key={day.date}
            accessible
            accessibilityLabel={`${day.date}: ${day.runs} runs, ${usd(day.usage.costUsd)}`}
            style={{
              flex: 1,
              height:
                peak === 0 || day.runs === 0
                  ? 1
                  : Math.max(3, (day.usage.costUsd / peak) * CHART_HEIGHT),
              backgroundColor: day.runs === 0 ? Ghost.rule : Ghost.accent,
            }}
          />
        ))}
      </View>
      {labelled ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {days.map((day) => (
            <Mono key={day.date} size={10} style={{ flex: 1, textAlign: 'center' }}>
              {dayLabel(day.date)}
            </Mono>
          ))}
        </View>
      ) : (
        <View style={styles.between}>
          <Mono size={10}>{days[0]?.date.slice(5) ?? ''}</Mono>
          <Mono size={10}>{days[days.length - 1]?.date.slice(5) ?? ''}</Mono>
        </View>
      )}
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: Gutter, paddingTop: 26, gap: 14 }}>
      <Mono>{title}</Mono>
      {children}
    </View>
  )
}

const spend = (usage: TokenUsage, runs: number) =>
  `${runs} ${runs === 1 ? 'run' : 'runs'} · ${tokens(totalTokens(usage))} tokens · ${usd(usage.costUsd)}`

function ChatRow({ chat }: { chat: ChatUsage }) {
  const share = chat.context === null ? null : contextShare(chat.context)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        continueSession(chat.sessionId)
        router.navigate('/')
      }}
      style={({ pressed }) => [styles.chat, pressed && { backgroundColor: Ghost.swatch }]}
    >
      <View style={styles.between}>
        <Body size={15} style={{ flex: 1 }} lines={1}>
          {chat.title}
        </Body>
        <Meta size={12}>{age(chat.lastAt)}</Meta>
      </View>
      <Meta size={12}>{spend(chat.usage, chat.runs)}</Meta>
      {share === null ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <FillBar share={share} />
          </View>
          <Meta size={12} color={fillTone(share)}>
            {percent(share)} context
          </Meta>
        </View>
      )}
    </Pressable>
  )
}

/** What Claude has spent for Ghost: the plan's meters, then where the tokens went. */
export default function UsageScreen() {
  const bottomInset = useBottomInset()
  const [range, setRange] = useState<UsageRange>('day')
  const usage = useUsage(range)
  const pull = usePullRefresh(usage.refetch)
  const report = usage.data
  const meter = report ? fiveHour(report.limits) : undefined
  const caption = RANGES.find((each) => each.value === range)?.caption ?? ''

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <LegendList
        data={report?.chats ?? []}
        keyExtractor={(chat) => chat.sessionId}
        recycleItems
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        ListHeaderComponent={
          <View>
            <PageHeader
              title="USAGE"
              subtitle="Claude plan"
              figure={meter ? Math.round(meter.utilization * 100) : '—'}
              figureSuffix={meter ? '%' : undefined}
              figureColor={meter ? fillTone(meter.utilization) : Ghost.ink}
              caption="Five-hour"
            />
            {report && report.limits.length > 0 ? (
              <Section title="PLAN">
                {report.limits.map((limit) => (
                  <Meter key={limit.window} limit={limit} />
                ))}
                {report.limitsSeenAt ? (
                  <Meta size={12} color={Ghost.dim}>
                    Read on Ghost's last run · {age(report.limitsSeenAt)}
                  </Meta>
                ) : null}
              </Section>
            ) : null}
            <View
              style={{ flexDirection: 'row', gap: 6, paddingHorizontal: Gutter, paddingTop: 26 }}
            >
              {RANGES.map((each) => (
                <Chip
                  key={each.value}
                  label={each.label}
                  active={range === each.value}
                  onPress={() => setRange(each.value)}
                />
              ))}
            </View>
            {report ? (
              <>
                <Section title={caption.toUpperCase()}>
                  <Totals total={report.total} runs={report.runs} />
                </Section>
                <Section title="BY DAY">
                  <DayChart days={report.byDay} />
                </Section>
                {report.bySource.length > 0 ? (
                  <Section title="BY SOURCE">
                    {report.bySource.map((source) => (
                      <View key={source.source} style={styles.between}>
                        <Body size={14} color={Ghost.soft}>
                          {SOURCE_LABELS[source.source]}
                        </Body>
                        <Meta size={12}>{spend(source.usage, source.runs)}</Meta>
                      </View>
                    ))}
                  </Section>
                ) : null}
                <View style={{ paddingHorizontal: Gutter, paddingTop: 26, paddingBottom: 6 }}>
                  <Mono>CHATS</Mono>
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Body color={Ghost.dim} style={{ paddingHorizontal: Gutter, paddingTop: 14 }}>
            {usage.isPending
              ? 'Loading…'
              : usage.isError
                ? "Can't reach the Ghost server."
                : 'No chats in this range. Every answer Ghost gives is counted here.'}
          </Body>
        }
        renderItem={({ item }) => <ChatRow chat={item} />}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  chart: { height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end' },
  chat: {
    paddingVertical: 12,
    paddingHorizontal: Gutter,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
  },
})
