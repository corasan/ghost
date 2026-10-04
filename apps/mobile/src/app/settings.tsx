import { router } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { useState } from "react"
import { ScrollView, StyleSheet, TextInput, View } from "react-native"
import { Body, Button, Header, Mono } from "@/components/ui"
import { useBungieAuthStart, useHealth } from "@/lib/api"
import { setServerUrl, useServerUrl } from "@/lib/server-url"
import { colors, fonts } from "@/theme"

export default function SettingsScreen() {
  const serverUrl = useServerUrl()
  const [draft, setDraft] = useState(serverUrl)
  const health = useHealth()
  const authStart = useBungieAuthStart()

  const link = () =>
    authStart.mutate(undefined, { onSuccess: ({ url }) => WebBrowser.openBrowserAsync(url) })

  const connection = health.isPending
    ? "CONNECTING"
    : health.isError
      ? "UNREACHABLE"
      : health.data.bungieLinked
        ? "CONNECTED · BUNGIE LINKED"
        : "CONNECTED · BUNGIE NOT LINKED"

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Header eyebrow="‹ GHOST" title="Settings" onPressEyebrow={() => router.back()} />

      <View style={styles.section}>
        <Mono size={9} color={colors.muted} tracking={1.3}>
          SERVER
        </Mono>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="http://host:4848"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Body size={12} color={colors.dim}>
          The tailnet address of the machine running the Ghost server, for example
          http://my-mac.tail1234.ts.net:4848.
        </Body>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label="Save"
            tone="accent"
            onPress={() => setServerUrl(draft)}
            disabled={draft.trim() === serverUrl}
          />
        </View>
        <Mono color={health.isError ? colors.red : colors.accent}>{connection}</Mono>
      </View>

      <View style={styles.section}>
        <Mono size={9} color={colors.muted} tracking={1.3}>
          BUNGIE ACCOUNT
        </Mono>
        <Body size={12} color={colors.dim}>
          Sign in with Bungie in the browser. The server keeps the tokens; the app never sees them.
        </Body>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            label={health.data?.bungieLinked ? "Re-link account" : "Link account"}
            onPress={link}
            disabled={!health.data}
            busy={authStart.isPending}
          />
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24, gap: 10 },
  input: {
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
  },
})
