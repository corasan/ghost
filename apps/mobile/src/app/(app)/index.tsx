import type { Job } from '@ghost/contract'
import { LegendList, type LegendListRef } from '@legendapp/list/react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

import { BriefingView } from '@/components/chat/briefing'
import { Composer, REVISION_STARTERS, Starters } from '@/components/chat/composer'
import { ChatHeader } from '@/components/chat/header'
import { MessageView } from '@/components/chat/message'
import { Body, Cond, Mono } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { errorMessage, useBriefing, useCreateJob, useJobs, useSavedBuilds } from '@/lib/api'
import { useCharacter } from '@/lib/character'
import { usePullRefresh } from '@/lib/refresh'
import { continueSession, startFreshSession, usePendingRevision, useSessionId } from '@/lib/session'

type Entry = { type: 'job'; job: Job } | { type: 'briefing' }

/**
 * Chat is home. It shows one conversation, oldest request at the top, with
 * Ghost's briefing placed where this visit starts: on open you land on what
 * changed since last time, with the conversation's older requests above it.
 * A fresh chat is the briefing alone.
 */
export default function ChatScreen() {
  const { draft: queued } = useLocalSearchParams<{ draft?: string }>()
  const [draft, setDraft] = useState('')
  const list = useRef<LegendListRef>(null)

  const { character } = useCharacter()
  const characterId = character?.characterId
  const briefing = useBriefing(characterId)
  const sessionId = useSessionId()
  const jobs = useJobs(sessionId)
  const createJob = useCreateJob()
  const pending = usePendingRevision()
  const revisingId =
    sessionId === null ? pending : (jobs.data?.find((job) => job.buildId !== null)?.buildId ?? null)
  const revising = useSavedBuilds().data?.find((build) => build.id === revisingId)
  const pull = usePullRefresh(jobs.refetch, briefing.refetch)

  // A page's "ASK ›" returns here with its suggestion queued in the composer.
  useEffect(() => {
    if (!queued) return
    setDraft(queued)
    router.setParams({ draft: undefined })
  }, [queued])

  const since = briefing.data?.since ?? null
  const entries = useMemo<Entry[]>(() => {
    const ordered = [...(jobs.data ?? [])].reverse()
    const before = since === null ? [] : ordered.filter((job) => job.createdAt <= since)
    const after = since === null ? ordered : ordered.filter((job) => job.createdAt > since)
    return [
      ...before.map((job) => ({ type: 'job' as const, job })),
      { type: 'briefing' as const },
      ...after.map((job) => ({ type: 'job' as const, job })),
    ]
  }, [jobs.data, since])

  const asked = entries.length > 0 && entries[entries.length - 1]?.type === 'job'
  const hasHistory = entries.length > 1

  const ask = useCallback(
    (prompt: string) => {
      const text = prompt.trim()
      if (text === '') return
      createJob.mutate(
        {
          kind: 'chat',
          prompt: text,
          characterId: characterId ?? null,
          sessionId,
          buildId: sessionId === null ? pending : undefined,
        },
        {
          onSuccess: (job) => {
            if (job.sessionId !== null) continueSession(job.sessionId)
            setDraft('')
            list.current?.scrollToEnd({ animated: true })
          },
        },
      )
    },
    [createJob, characterId, sessionId, pending],
  )

  const renderItem = useCallback(
    ({ item }: { item: Entry }) =>
      item.type === 'briefing' ? (
        <BriefingView
          briefing={briefing.data}
          character={character}
          failed={briefing.isError}
          greet={!hasHistory}
          onAsk={ask}
        />
      ) : (
        <MessageView job={item.job} onAsk={ask} />
      ),
    [briefing.data, briefing.isError, character, hasHistory, ask],
  )

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
      <ChatHeader
        character={character}
        ruled={asked}
        onNewChat={hasHistory ? startFreshSession : undefined}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <LegendList
          ref={list}
          key={sessionId ?? 'fresh'}
          data={entries}
          renderItem={renderItem}
          recycleItems={false}
          extraData={renderItem}
          keyExtractor={(item) => (item.type === 'briefing' ? 'briefing' : item.job.id)}
          getItemType={(item) => item.type}
          estimatedItemSize={160}
          // Chat semantics: start at the newest message, stay pinned to the
          // bottom as answers arrive, and keep your place when older rows
          // above change height.
          alignItemsAtEnd={hasHistory}
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainVisibleContentPosition
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 12 }}
          ItemSeparatorComponent={Gap}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
        {hasHistory ? null : (
          <Starters onAsk={ask} prompts={revising ? REVISION_STARTERS : undefined} />
        )}
        {revising ? <Revising name={revising.name} /> : null}
        {createJob.isError ? (
          <Body size={13} color={Ghost.danger} style={{ paddingHorizontal: 20, paddingTop: 8 }}>
            Couldn't reach Ghost: {errorMessage(createJob.error)}
          </Body>
        ) : null}
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => ask(draft)}
          sending={createJob.isPending}
          placeholder={revising ? `What should change in ${revising.name}?` : undefined}
        />
      </KeyboardAvoidingView>
    </View>
  )
}

/** Shown while the conversation revises a saved build; ending it starts a fresh chat. */
function Revising({ name }: { name: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginHorizontal: 16,
        marginTop: 12,
        paddingLeft: 12,
        borderLeftWidth: 2,
        borderLeftColor: Ghost.accent,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Mono>REVISING</Mono>
        <Cond size={14} lines={1}>
          {name.toUpperCase()}
        </Cond>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop revising"
        hitSlop={10}
        onPress={startFreshSession}
        style={({ pressed }) => pressed && { opacity: 0.6 }}
      >
        <Cond size={14} color={Ghost.accent}>
          DONE
        </Cond>
      </Pressable>
    </View>
  )
}

function Gap() {
  return <View style={{ height: 28 }} />
}
