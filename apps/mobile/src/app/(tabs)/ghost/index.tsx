import { router, Stack, useLocalSearchParams } from "expo-router"
import { type ComponentRef, useEffect, useRef, useState } from "react"
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ExampleCard } from "@/components/ghost/example-card"
import { Mono } from "@/components/ghost/ui"
import { BottomTabInset, Ghost, Type } from "@/constants/theme"
import { useCreateJob, useHealth, useJobs } from "@/lib/api"
import { examples } from "@/lib/sample"

// The native tab bar floats over the screen, so the composer has to clear it
// until the keyboard covers the bar.
function useTabBarInset() {
  const insets = useSafeAreaInsets()
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setKeyboard(true))
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboard(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return keyboard ? 0 : insets.bottom + BottomTabInset
}

function Asked({ children }: { children: string }) {
  return <Text style={[styles.bubble, styles.asked]}>{children}</Text>
}

function Answered({ children, tone }: { children: string; tone?: "muted" | "danger" }) {
  return (
    <Text
      style={[
        styles.bubble,
        styles.answered,
        tone === "muted" && { color: Ghost.muted },
        tone === "danger" && { color: Ghost.danger },
      ]}
    >
      {children}
    </Text>
  )
}

export default function GhostScreen() {
  const { prompt } = useLocalSearchParams<{ prompt?: string }>()
  const [draft, setDraft] = useState("")
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const health = useHealth()
  const jobs = useJobs()
  const createJob = useCreateJob()
  const tabBarInset = useTabBarInset()

  // A banner or the Vault tab queues a request by navigating here with it.
  useEffect(() => {
    if (!prompt) return
    setDraft(prompt)
    router.setParams({ prompt: undefined })
  }, [prompt])

  const thread = [...(jobs.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const text = draft.trim()

  const send = (request: string) =>
    createJob.mutate({ kind: "chat", prompt: request }, { onSuccess: () => setDraft("") })

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: "Ghost", headerLargeTitle: false }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="clock.arrow.circlepath"
          accessibilityLabel="History"
          onPress={() => router.push("/ghost/history")}
        />
        <Stack.Toolbar.Button
          icon="gearshape"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
        />
      </Stack.Toolbar>

      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (thread.length > 0) scroll.current?.scrollToEnd({ animated: false })
        }}
      >
        <Mono color={health.data ? Ghost.muted : Ghost.danger} style={{ alignSelf: "center" }}>
          {health.data ? "MCP · ONLINE" : health.isPending ? "MCP · …" : "MCP · OFFLINE"}
        </Mono>
        {thread.length === 0 ? (
          <>
            <Mono size={9} color={Ghost.dim}>
              EXAMPLES · TAP ONE TO ASK IT
            </Mono>
            {examples.map((example) => (
              <Pressable
                key={example.prompt}
                style={{ gap: 8 }}
                onPress={() => setDraft(example.prompt)}
              >
                <Asked>{example.prompt}</Asked>
                <View style={{ width: "96%", gap: 8 }} pointerEvents="none">
                  <Answered>{example.reply}</Answered>
                  <ExampleCard example={example} />
                </View>
              </Pressable>
            ))}
          </>
        ) : (
          thread.map((job) => (
            <View key={job.id} style={{ gap: 8 }}>
              <Asked>{job.prompt}</Asked>
              {job.error ? (
                <Answered tone="danger">{job.error}</Answered>
              ) : job.result ? (
                <Answered>{job.result}</Answered>
              ) : (
                <Answered tone="muted">Working…</Answered>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {createJob.isError ? (
        <Mono color={Ghost.danger} style={{ paddingHorizontal: 20 }}>
          COULDN'T REACH GHOST · TRY AGAIN
        </Mono>
      ) : null}
      <View style={[styles.composer, { marginBottom: tabBarInset }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask Ghost…"
          placeholderTextColor={Ghost.dim}
          keyboardAppearance="dark"
          multiline
          style={styles.input}
        />
        <Pressable
          accessibilityLabel="Send"
          disabled={text === "" || createJob.isPending}
          onPress={() => send(text)}
          style={[styles.send, text !== "" && { backgroundColor: Ghost.accent }]}
        >
          <Text style={{ fontSize: 18, color: text === "" ? Ghost.muted : Ghost.onAccent }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  thread: { paddingHorizontal: 16, paddingVertical: 18, gap: 14 },
  bubble: {
    fontFamily: Type.regular,
    fontSize: 15,
    lineHeight: 21,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    overflow: "hidden",
  },
  asked: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    backgroundColor: Ghost.accent,
    color: Ghost.onAccent,
    borderBottomRightRadius: 4,
  },
  answered: {
    alignSelf: "flex-start",
    maxWidth: "96%",
    backgroundColor: Ghost.card,
    color: Ghost.text,
    borderWidth: 1,
    borderColor: Ghost.line,
    borderBottomLeftRadius: 4,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    backgroundColor: Ghost.card,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: Type.regular,
    fontSize: 15,
    color: Ghost.text,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Ghost.card,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
})
