import { router } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { View } from "react-native"
import { Body, Button, Centered, Diamond, Mono } from "@/components/ui"
import { errorMessage, isNotLinked, useBungieAuthStart, useHealth } from "@/lib/api"
import { colors } from "@/theme"

// Shown in place of any Bungie-backed screen until the account is linked or
// the server can be reached. One component so every tab fails the same way.
export function Unavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const health = useHealth()
  const authStart = useBungieAuthStart()
  const link = () =>
    authStart.mutate(undefined, { onSuccess: ({ url }) => WebBrowser.openBrowserAsync(url) })

  if (health.isError) {
    return (
      <Centered>
        <Diamond size={14} hollow />
        <Body size={16} weight="medium">
          Ghost can't reach the server
        </Body>
        <Body size={13} color={colors.dim} style={{ textAlign: "center" }}>
          Check that the server is running on your tailnet and that the address is right.
        </Body>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Button label="Server settings" onPress={() => router.push("/settings")} flex={0} />
          <Button label="Retry" tone="accent" onPress={onRetry} flex={0} />
        </View>
      </Centered>
    )
  }

  if (isNotLinked(error)) {
    return (
      <Centered>
        <Diamond size={14} glow />
        <Body size={16} weight="medium">
          Link your Bungie account
        </Body>
        <Body size={13} color={colors.dim} style={{ textAlign: "center" }}>
          Sign in with Bungie in the browser. The server keeps the tokens; the app never sees them.
        </Body>
        <View style={{ marginTop: 8 }}>
          <Button
            label="Link account"
            tone="accent"
            onPress={link}
            busy={authStart.isPending}
            flex={0}
          />
        </View>
      </Centered>
    )
  }

  return (
    <Centered>
      <Mono color={colors.red}>BUNGIE ERROR</Mono>
      <Body size={13} color={colors.dim} style={{ textAlign: "center" }}>
        {errorMessage(error)}
      </Body>
      <View style={{ marginTop: 8 }}>
        <Button label="Retry" onPress={onRetry} flex={0} />
      </View>
    </Centered>
  )
}
