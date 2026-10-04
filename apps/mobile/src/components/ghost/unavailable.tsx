import { router } from "expo-router"
import { View } from "react-native"

import { Ghost } from "@/constants/theme"
import { errorMessage, useHealth } from "@/lib/api"
import { Body, Button, Cond } from "./ui"

export function Unavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const health = useHealth()

  const state = health.isError
    ? {
        title: "GHOST CAN'T REACH THE SERVER",
        detail: "Check that the server is running and that the address is right.",
        action: "SERVER SETTINGS",
      }
    : { title: "BUNGIE ERROR", detail: errorMessage(error), action: null }

  return (
    <View style={{ paddingVertical: 40, gap: 10 }}>
      <Cond size={18}>{state.title}</Cond>
      <Body size={14} color={Ghost.dim}>
        {state.detail}
      </Body>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        {state.action ? (
          <Button label={state.action} onPress={() => router.push("/settings")} />
        ) : null}
        <Button label="RETRY" tone="solid" onPress={onRetry} />
      </View>
    </View>
  )
}
