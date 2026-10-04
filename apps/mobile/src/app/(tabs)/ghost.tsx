import type { Job, JobKind } from "@ghost/contract"
import { router, useLocalSearchParams } from "expo-router"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Body, Diamond, Mono } from "@/components/ui"
import { getLastLatency, useCreateJob, useHealth, useJobs } from "@/lib/api"
import { kindLabel } from "@/lib/format"
import { colors, fonts } from "@/theme"

const KINDS: ReadonlyArray<JobKind> = [
  "chat",
  "build_suggestion",
  "weapon_rolls",
  "vault_cleanup",
  "postmaster_to_vault",
]

// 02/03/05 · Ghost tab. Chat lives here and only here. Every request is a
// job on the server; the transcript is the job list: your prompt as the
// right-hand bubble, Ghost's answer as the left-hand one.
export default function GhostScreen() {
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ prompt?: string; kind?: string }>()
  const health = useHealth()
  const jobs = useJobs()
  const createJob = useCreateJob()
  const [draft, setDraft] = useState("")
  const [kind, setKind] = useState<JobKind>("chat")
  const scroll = useRef<ScrollViewInstance>(null)

  // Other tabs hand off a suggestion ("Ask Ghost →") through route params.
  useEffect(() => {
    if (params.prompt) setDraft(params.prompt)
    if (params.kind && KINDS.includes(params.kind as JobKind)) setKind(params.kind as JobKind)
  }, [params.prompt, params.kind])

  const send = () => {
    const prompt = draft.trim()
    if (prompt === "" || createJob.isPending) return
    createJob.mutate({ kind, prompt }, { onSuccess: () => setDraft("") })
  }

  const transcript = [...(jobs.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const latency = getLastLatency()
  const status = health.isError
    ? "OFFLINE"
    : latency === null
      ? "MCP · LOCAL"
      : `MCP · LOCAL · ${latency}ms`

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          onPress={() => router.push("/history")}
        >
          <Diamond glow />
          <Text style={styles.brand}>GHOST</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
          <Mono color={health.isError ? colors.red : colors.dim}>{status}</Mono>
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.transcript}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardDismissMode="interactive"
      >
        {transcript.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 80, gap: 10 }}>
            <Diamond size={14} hollow />
            <Body size={13} color={colors.dim} style={{ textAlign: "center", maxWidth: 260 }}>
              Ask in plain language. Ghost proposes a plan; nothing happens until you confirm.
            </Body>
          </View>
        ) : (
          transcript.map((job) => <Exchange key={job.id} job={job} />)
        )}
      </ScrollView>

      <View style={styles.kinds}>
        {KINDS.map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} hitSlop={6}>
            <Mono size={9} color={k === kind ? colors.accent : colors.muted}>
              {kindLabel[k].toUpperCase()}
            </Mono>
          </Pressable>
        ))}
      </View>

      <View style={[styles.composer, { paddingBottom: 10 }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask Ghost…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={send}
          submitBehavior="submit"
        />
        <Pressable onPress={send} disabled={createJob.isPending} style={styles.send}>
          {createJob.isPending ? <ActivityIndicator color={colors.dim} /> : <Diamond size={12} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function Exchange({ job }: { job: Job }) {
  const pending = job.status === "queued" || job.status === "running"
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{job.prompt}</Text>
      </View>
      <View style={styles.ghostBubble}>
        {job.kind !== "chat" ? (
          <Mono size={9} color={colors.accent} style={{ marginBottom: 4 }}>
            {kindLabel[job.kind].toUpperCase()}
          </Mono>
        ) : null}
        {pending ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Mono>{job.status === "queued" ? "QUEUED" : "WORKING…"}</Mono>
          </View>
        ) : job.status === "failed" ? (
          <Body size={14} color={colors.red}>
            {job.error ?? "Something went wrong."}
          </Body>
        ) : (
          <Body size={15}>{job.result ?? "Done."}</Body>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text, letterSpacing: 0.4 },
  transcript: { padding: 16, gap: 14, flexGrow: 1 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderBottomRightRadius: 4,
  },
  userText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.accentInk },
  ghostBubble: {
    alignSelf: "flex-start",
    maxWidth: "96%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
  },
  kinds: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
})
