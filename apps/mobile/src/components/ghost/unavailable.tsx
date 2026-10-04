import { router } from "expo-router"
import { StyleSheet, Text, View } from "react-native"

import { Ghost, Type } from "@/constants/theme"
import { errorMessage, useHealth } from "@/lib/api"
import { ActionButton } from "./ui"

export function Unavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const health = useHealth()

  const state = health.isError
    ? {
        title: "Ghost can't reach the server",
        detail: "Check that the server is running and that the address is right.",
        action: "Server settings",
      }
    : { title: "Bungie error", detail: errorMessage(error), action: null }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{state.title}</Text>
      <Text style={styles.detail}>{state.detail}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {state.action ? (
          <ActionButton label={state.action} onPress={() => router.push("/settings")} />
        ) : null}
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
