import { router } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ActionButton, Diamond, Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { useBungieAuthStart, useHealth } from "@/lib/api"
import { useServerUrl } from "@/lib/server-url"

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const serverUrl = useServerUrl()
  const health = useHealth()
  const authStart = useBungieAuthStart()
  const online = health.data !== undefined

  // Sign-in finishes in the browser against the server, so the app learns
  // about it by asking the server again once the browser closes.
  const signIn = () =>
    authStart.mutate(undefined, {
      onSuccess: async ({ url }) => {
        await WebBrowser.openBrowserAsync(url)
        await health.refetch()
      },
    })

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.hero}>
        <View style={styles.glow}>
          <Diamond size={18} />
        </View>
        <Text style={styles.title}>Ghost</Text>
        <Text style={styles.tagline}>
          Ask in plain language. Ghost proposes a plan, and nothing happens until you confirm.
        </Text>
      </View>

      <View style={{ gap: 14 }}>
        <View style={[styles.button, !online && { opacity: 0.4 }]}>
          <ActionButton
            label={authStart.isPending ? "Opening Bungie…" : "Sign in with Bungie"}
            tone="accent"
            onPress={online && !authStart.isPending ? signIn : undefined}
          />
        </View>
        <Text style={styles.note}>
          Sign-in happens in the browser. The server keeps the tokens; the app never sees them.
        </Text>
        <Pressable hitSlop={12} style={styles.server} onPress={() => router.push("/settings")}>
          <View style={[styles.dot, { backgroundColor: online ? Ghost.good : Ghost.danger }]} />
          <Mono color={online ? Ghost.muted : Ghost.danger}>
            {online ? "SERVER · ONLINE" : "SERVER · UNREACHABLE"}
          </Mono>
          <Mono color={Ghost.dim} style={{ letterSpacing: 0 }}>
            {serverUrl.replace(/^https?:\/\//, "")}
          </Mono>
          <Mono color={Ghost.accent}>CHANGE ›</Mono>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Ghost.bg, paddingHorizontal: 24 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  glow: {
    marginBottom: 14,
    shadowColor: Ghost.accent,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { fontFamily: Type.semibold, fontSize: 40, letterSpacing: -0.8, color: Ghost.text },
  tagline: {
    fontFamily: Type.light,
    fontSize: 15,
    lineHeight: 23,
    color: Ghost.muted,
    textAlign: "center",
    maxWidth: 300,
  },
  button: { flexDirection: "row" },
  note: {
    fontFamily: Type.regular,
    fontSize: 12,
    lineHeight: 17,
    color: Ghost.dim,
    textAlign: "center",
  },
  server: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
