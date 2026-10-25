import type { ChatUsage, PlanLimit, TokenUsage, UsageDay, UsageRange } from '@ghost/contract'
import { LegendList } from '@legendapp/list/react-native'
import { type ReactNode, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Body, Cond, Meta, Mono, PageHeader } from '@/components/ghost/ui'
import { FillBar, fillTone } from '@/components/usage/fill-bar'
import { Ghost, Gutter } from '@/constants/theme'
import { useUsage } from '@/lib/api'
import { percent, tokens, until, usd } from '@/lib/format'
import { useBottomInset } from '@/lib/insets'
import { usePullRefresh } from '@/lib/refresh'
import { contextShare, limitLabel, SOURCE_LABELS, uncachedTokens } from '@/lib/usage'

const RANGES: ReadonlyArray<{ value: UsageRange; label: string }> = [
  { value: 'day', label: '24H' },
  { value: 'week', label: '7D' },
  { value: 'month', label: '30D' },
]

const WARN_FROM = 0.75

const figureTone = (share: number) => (share >= WARN_FROM ? fillTone(share) : Ghost.ink)

function RangeControl({
  range,
  onChange,
}: {
  range: UsageRange
  onChange: (range: UsageRange) => void
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {RANGES.map((each) => {
        const active = range === each.value
        return (
          <Pressable
            key={each.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={6}
            onPress={() => onChange(each.value)}
            style={{
              paddingHorizontal: 9,
              paddingVertical: 3,
              backgroundColor: active ? Ghost.swatch : 'transparent',
              borderWidth: 1,
              borderColor: active ? Ghost.ruleStrong : 'transparent',
            }}
          >
            <Cond size={14} color={active ? Ghost.ink : Ghost.dim}>
              {each.label}
            </Cond>
          </Pressable>
        )
      })}
    </View>
  )
}

const CHART_HEIGHT = 64

function Meter({ limit }: { limit: PlanLimit }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.between, { alignItems: 'flex-end' }]}>
        <View style={{ gap: 4 }}>
          <Mono color={Ghost.muted}>{limitLabel(limit.window)}</Mono>
          <Mono>
            {limit.resetsAt === null ? 'RESET' : `RESETS ${until(limit.resetsAt).toUpperCase()}`}
          </Mono>
        </View>
        <Cond size={26} color={figureTone(limit.utilization)}>
          {percent(limit.utilization)}
        </Cond>
      </View>
      <FillBar share={limit.utilization} height={6} />
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'flex-end', gap: 2 }}>
      <Cond size={15} color={Ghost.soft}>
        {value}
      </Cond>
      <Mono>{label}</Mono>
    </View>
  )
}

const dayLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    weekday: 'short',
  })
}

function DayChart({ days }: { days: ReadonlyArray<UsageDay> }) {
  const peak = Math.max(...days.map((day) => day.usage.costUsd), 0)
  const labelled = days.length <= 7
  const gap = labelled ? 6 : 2
  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.chart, { gap }]}>
        {days.map((day, index) => (
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
              backgroundColor:
                day.runs === 0
                  ? Ghost.rule
                  : index === days.length - 1
                    ? Ghost.accent
                    : Ghost.ruleStrong,
            }}
          />
        ))}
      </View>
      {labelled ? (
        <View style={{ flexDirection: 'row', gap }}>
          {days.map((day) => (
            <Mono key={day.date} style={{ flex: 1, textAlign: 'center' }}>
              {dayLabel(day.date).toUpperCase()}
            </Mono>
          ))}
        </View>
      ) : (
        <View style={styles.between}>
          <Mono>{days[0]?.date.slice(5) ?? ''}</Mono>
          <Mono>{days[days.length - 1]?.date.slice(5) ?? ''}</Mono>
        </View>
      )}
    </View>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <View style={{ paddingHorizontal: Gutter, paddingTop: 40, gap: 16 }}>
      <View style={styles.between}>
        <Mono color={Ghost.muted}>{title}</Mono>
        {aside}
      </View>
      {children}
    </View>
  )
}

function ListLabel({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: Gutter, paddingTop: 40, paddingBottom: 4 }}>
      <Mono color={Ghost.muted}>{title}</Mono>
    </View>
  )
}

const CONTEXT_BAR_FROM = 0.25

function Breakdown({
  usage,
  runs,
  share,
}: {
  usage: TokenUsage
  runs: number
  share: number | null
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, paddingTop: 8 }}>
      {[
        ['RUNS', String(runs)],
        ['INPUT', tokens(usage.inputTokens)],
        ['OUTPUT', tokens(usage.outputTokens)],
        ['CACHE READ', tokens(usage.cacheReadTokens)],
        ['CACHE WRITE', tokens(usage.cacheWriteTokens)],
        ...(share === null ? [] : [['CONTEXT', percent(share)]]),
      ].map(([label, value]) => (
        <View key={label} style={{ width: '33.33%', gap: 3 }}>
          <Mono size={9}>{label}</Mono>
          <Meta size={13} color={Ghost.soft}>
            {value}
          </Meta>
        </View>
      ))}
    </View>
  )
}

function UsageRow({
  title,
  usage,
  runs,
  weight,
  share = null,
}: {
  title: string
  usage: TokenUsage
  runs: number
  weight?: number
  share?: number | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint="Shows the token breakdown"
      onPress={() => setOpen(!open)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: Ghost.swatch }]}
    >
      <Body size={15} lines={2}>
        {title}
      </Body>
      <Mono>{`${tokens(uncachedTokens(usage))} TOKENS · ${usd(usage.costUsd)}`}</Mono>
      {weight === undefined ? null : (
        <View style={{ height: 2, marginTop: 4 }}>
          <View style={{ width: `${weight * 100}%`, height: 2, backgroundColor: Ghost.accent }} />
        </View>
      )}
      {share !== null && share >= CONTEXT_BAR_FROM ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <FillBar share={share} />
          </View>
          <Meta size={12} color={fillTone(share)}>
            {percent(share)} context
          </Meta>
        </View>
      ) : null}
      {open ? <Breakdown usage={usage} runs={runs} share={share} /> : null}
    </Pressable>
  )
}

function ChatRow({ chat, heaviest }: { chat: ChatUsage; heaviest: number }) {
  return (
    <UsageRow
      title={chat.title}
      usage={chat.usage}
      runs={chat.runs}
      weight={heaviest === 0 ? 0 : uncachedTokens(chat.usage) / heaviest}
      share={chat.context === null ? null : contextShare(chat.context)}
    />
  )
}

/** What Claude has spent for Ghost: the plan's meters, then where the tokens went. */
export default function UsageScreen() {
  const bottomInset = useBottomInset()
  const [range, setRange] = useState<UsageRange>('day')
  const usage = useUsage(range)
  const pull = usePullRefresh(usage.refetch)
  const report = usage.data
  const heaviest = Math.max(0, ...(report?.chats ?? []).map((chat) => uncachedTokens(chat.usage)))

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <LegendList
        data={report?.chats ?? []}
        keyExtractor={(chat) => chat.sessionId}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        ListHeaderComponent={
          <View>
            <PageHeader title="USAGE" />
            {report && report.limits.length > 0 ? (
              <Section title="CLAUDE PLAN LIMITS">
                {report.limits.map((limit) => (
                  <Meter key={limit.window} limit={limit} />
                ))}
              </Section>
            ) : null}
            {report ? (
              <>
                <Section title="SPEND" aside={<RangeControl range={range} onChange={setRange} />}>
                  <View style={[styles.between, { alignItems: 'flex-end' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                      <Cond size={34}>{tokens(uncachedTokens(report.total))}</Cond>
                      <Mono>TOKENS</Mono>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 22, paddingBottom: 4 }}>
                      <Stat label="RUNS" value={String(report.runs)} />
                      <Stat label="EST. COST" value={usd(report.total.costUsd)} />
                    </View>
                  </View>
                </Section>
                {range === 'day' ? null : (
                  <Section title="BY DAY">
                    <DayChart days={report.byDay} />
                  </Section>
                )}
                {report.bySource.length > 1 ? (
                  <>
                    <ListLabel title="BY SOURCE" />
                    {report.bySource.map((source) => (
                      <UsageRow
                        key={source.source}
                        title={SOURCE_LABELS[source.source]}
                        usage={source.usage}
                        runs={source.runs}
                      />
                    ))}
                  </>
                ) : null}
                <ListLabel title="CHATS" />
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
        renderItem={({ item }) => <ChatRow chat={item} heaviest={heaviest} />}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  chart: { height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end' },
  row: {
    paddingVertical: 14,
    marginHorizontal: Gutter,
    gap: 6,
  },
})
