import type { Job } from "@ghost/contract"
import { LegendList, type LegendListRef } from "@legendapp/list/react-native"
import { router, useLocalSearchParams } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Keyboard, KeyboardAvoidingView, Platform, View } from "react-native"

import { BriefingView } from "@/components/chat/briefing"
import { Composer, Starters } from "@/components/chat/composer"
import { ChatHeader } from "@/components/chat/header"
import { GuardianMenu } from "@/components/chat/menu"
import { MessageView } from "@/components/chat/message"
import { Body } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { errorMessage, useBriefing, useCreateJob, useJobs } from "@/lib/api"
import { useCharacter } from "@/lib/character"

type Entry = { type: "job"; job: Job } | { type: "briefing" }

function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setOpen(true))
    const hide = Keyboard.addListener("keyboardWillHide", () => setOpen(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return open
}

/**
 * Chat is the app. The conversation is every request you've made, oldest at
 * the top, with Ghost's briefing placed where this session starts: on open
 * you land on what changed since last time, with older requests above it.
 */
export default function ChatScreen() {
  const { draft: queued } = useLocalSearchParams<{ draft?: string }>()
  const [draft, setDraft] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const list = useRef<LegendListRef>(null)
  const keyboardOpen = useKeyboardOpen()

  const { character, characters } = useCharacter()
  const characterId = character?.characterId
  const briefing = useBriefing(characterId)
  const jobs = useJobs()
  const createJob = useCreateJob()

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
      ...before.map((job) => ({ type: "job" as const, job })),
      { type: "briefing" as const },
      ...after.map((job) => ({ type: "job" as const, job })),
    ]
  }, [jobs.data, since])

  const asked = entries.length > 0 && entries[entries.length - 1]?.type === "job"
  const hasHistory = entries.length > 1

  const ask = useCallback(
    (prompt: string) => {
      const text = prompt.trim()
      if (text === "") return
      createJob.mutate(
        { kind: "chat", prompt: text, characterId: characterId ?? null },
        {
          onSuccess: () => {
            setDraft("")
            list.current?.scrollToEnd({ animated: true })
          },
        },
      )
    },
    [createJob, characterId],
  )

  const renderItem = useCallback(
    ({ item }: { item: Entry }) =>
      item.type === "briefing" ? (
        <BriefingView
          briefing={briefing.data}
          character={character}
          failed={briefing.isError}
          onAsk={ask}
        />
      ) : (
        <MessageView job={item.job} onAsk={ask} />
      ),
    [briefing.data, briefing.isError, character, ask],
  )

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
      <ChatHeader character={character} ruled={asked} onMenu={() => setMenuOpen(true)} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <LegendList
          ref={list}
          data={entries}
          renderItem={renderItem}
          extraData={renderItem}
          keyExtractor={(item) => (item.type === "briefing" ? "briefing" : item.job.id)}
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
          refreshing={jobs.isRefetching || briefing.isRefetching}
          onRefresh={() => {
            void jobs.refetch()
            void briefing.refetch()
          }}
        />
        {!asked ? <Starters onAsk={ask} /> : null}
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
          keyboardOpen={keyboardOpen}
        />
      </KeyboardAvoidingView>
      <GuardianMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        character={character}
        characters={characters}
        briefing={briefing.data}
      />
    </View>
  )
}

function Gap() {
  return <View style={{ height: 28 }} />
}
