import type { Job, Source } from "@ghost/contract"
import * as WebBrowser from "expo-web-browser"
import { memo } from "react"
import { Pressable, View } from "react-native"

import { Body, Mono, Said } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { age, clock } from "@/lib/format"
import { SaidMarkdown } from "./markdown"
import { PlanBlock } from "./plan-block"
import { StepsSummary, Working } from "./steps"

// Roll, build and meta calls are only as good as the data behind them, so
// every answer lists what it was based on and how old that data is.
function Sources({ sources }: { sources: readonly Source[] }) {
  return (
    <View
      style={{ marginLeft: 14, flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 6 }}
    >
      <Mono>SOURCES</Mono>
      {sources.map((source) => {
        const label = `${source.label.toUpperCase()}${source.asOf ? ` · ${age(source.asOf)}` : ""}`
        return source.url ? (
          <Pressable
            key={`${source.label}${source.url}`}
            accessibilityRole="link"
            hitSlop={6}
            onPress={() => void WebBrowser.openBrowserAsync(source.url as string)}
          >
            <Mono color={Ghost.accent}>{label}</Mono>
          </Pressable>
        ) : (
          <Mono key={source.label} color={Ghost.muted}>
            {label}
          </Mono>
        )
      })}
    </View>
  )
}

function Message({ job, onAsk }: { job: Job; onAsk: (prompt: string) => void }) {
  const working = job.status === "queued" || job.status === "running"
  return (
    <View style={{ gap: 20 }}>
      <View style={{ alignSelf: "flex-end", maxWidth: "84%", alignItems: "flex-end" }}>
        <Mono style={{ marginBottom: 6 }}>YOU · {clock(job.createdAt)}</Mono>
        <Body size={16} style={{ textAlign: "right" }}>
          {job.prompt}
        </Body>
      </View>
      {job.error ? (
        <Said>
          <Body size={16} color={Ghost.danger}>
            {job.error}
          </Body>
        </Said>
      ) : working ? (
        <Working job={job} />
      ) : job.result ? (
        <SaidMarkdown>{job.result}</SaidMarkdown>
      ) : null}
      {job.plan ? <PlanBlock job={job} onAsk={onAsk} /> : null}
      {working ? null : <StepsSummary steps={job.steps} />}
      {job.sources.length > 0 ? <Sources sources={job.sources} /> : null}
    </View>
  )
}

// Polling hands back new Job objects every few seconds even when nothing
// changed, so compare on what can actually change instead of identity.
export const MessageView = memo(
  Message,
  (a, b) =>
    a.job.id === b.job.id &&
    a.job.updatedAt === b.job.updatedAt &&
    a.job.status === b.job.status &&
    a.job.steps.length === b.job.steps.length &&
    a.job.plan?.status === b.job.plan?.status &&
    a.onAsk === b.onAsk,
)
