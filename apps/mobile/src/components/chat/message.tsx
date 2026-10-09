import type { Job, Source } from '@ghost/contract'
import * as WebBrowser from 'expo-web-browser'
import { memo } from 'react'
import { Pressable, View } from 'react-native'

import { Body, Meta, Mono, Said } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { age, clock } from '@/lib/format'
import { webUrl } from '@/lib/links'
import { CleanupOffer } from './cleanup-offer'
import { SaidMarkdown } from './markdown'
import { PlanBlock } from './plan-block'
import { StepsSummary, Working } from './steps'

// Roll, build and meta calls are only as good as the data behind them, so
// every answer lists what it was based on and how old that data is.
function Sources({ sources }: { sources: readonly Source[] }) {
  return (
    <View
      style={{ marginLeft: 14, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6 }}
    >
      <Mono>SOURCES</Mono>
      {sources.map((source) => {
        const label = `${source.label}${source.asOf ? ` · ${age(source.asOf)}` : ''}`
        const link = source.url ? webUrl(source.url) : null
        return link !== null ? (
          <Pressable
            key={`${source.label}${source.url}`}
            accessibilityRole="link"
            hitSlop={6}
            onPress={() => void WebBrowser.openBrowserAsync(link)}
          >
            <Meta color={Ghost.accent}>{label}</Meta>
          </Pressable>
        ) : (
          <Meta key={source.label}>{label}</Meta>
        )
      })}
    </View>
  )
}

function Message({ job, onAsk }: { job: Job; onAsk: (prompt: string) => void }) {
  const working = job.status === 'queued' || job.status === 'running'
  return (
    <View style={{ gap: 20 }}>
      <View style={{ alignSelf: 'flex-end', maxWidth: '84%', alignItems: 'flex-end' }}>
        <Meta style={{ marginBottom: 4 }}>You · {clock(job.createdAt)}</Meta>
        <Body size={16} style={{ textAlign: 'right' }}>
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
      {job.plan ? <PlanBlock job={job} plan={job.plan} onAsk={onAsk} /> : null}
      {job.offer === 'cleanup_mode' && !working ? (
        <CleanupOffer characterId={job.characterId} />
      ) : null}
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
    a.job.offer === b.job.offer &&
    a.onAsk === b.onAsk,
)
