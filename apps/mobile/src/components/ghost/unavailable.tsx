import { router } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { StyleSheet, Text, View } from "react-native"

import { Ghost, Type } from "@/constants/theme"
import { errorMessage, isNotLinked, useBungieAuthStart, useHealth } from "@/lib/api"
import { ActionButton } from "./ui"

// Shown in place of Bungie-backed content until the server is reachable and
// the account is linked, so every tab fails the same way.
export function Unavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const health = useHealth()
  const authStart = useBungieAuthStart()

  const state = health.isError
    ? {
        title: "Ghost can't reach the server",
        detail: "Check that the server is running and that the address is right.",
        action: "Server settings",
        onPress: () => router.push("/settings"),
      }
    : isNotLinked(error)
      ? {
          title: "Link your Bungie account",
          detail: "Sign in with Bungie in the browser. The server keeps the tokens.",
          action: "Link account",
          onPress: () =>
            authStart.mutate(undefined, {
              onSuccess: ({ url }) => WebBrowser.openBrowserAsync(url),
            }),
        }
      : { title: "Bungie error", detail: errorMessage(error), action: null, onPress: undefined }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{state.title}</Text>
      <Text style={styles.detail}>{state.detail}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {state.action ? <ActionButton label={state.action} onPress={state.onPress} /> : null}
        <ActionButton label="Retry" tone="accent" onPress={onRetry} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { paddingVertical: 48, gap: 8 },
  title: { fontFamily: Type.medium, fontSize: 16, color: Ghost.text, textAlign: "center" },
  detail: {
    fontFamily: Type.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Ghost.dim,
    textAlign: "center",
  },
})
