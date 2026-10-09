import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Body, Button, Cond, Diamond, Meta, Mono } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { useBungieAuthStart, useHealth } from '@/lib/api'
import { useServerUrl } from '@/lib/server-url'
import { useBottomInset } from '@/lib/insets'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const bottomInset = useBottomInset()
  const serverUrl = useServerUrl()
  const health = useHealth()
  const authStart = useBungieAuthStart()
  const online = health.data !== undefined

  const signIn = () =>
    authStart.mutate(undefined, {
      onSuccess: async ({ url }) => {
        await WebBrowser.openBrowserAsync(url)
        await health.refetch()
      },
    })

  const status = online
    ? { label: 'Server · online', color: Ghost.good }
    : health.isPending
      ? { label: 'Server · connecting', color: Ghost.muted }
      : { label: 'Server · unreachable', color: Ghost.danger }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: bottomInset + 16 }]}>
      <View style={styles.hero}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Diamond size={12} />
          <Cond size={34} style={{ letterSpacing: 5 }}>
            GHOST
          </Cond>
        </View>
        <Body size={16} color={Ghost.muted} style={{ textAlign: 'center', maxWidth: 300 }}>
          Ask in plain language. Ghost proposes a plan, and nothing happens until you confirm.
        </Body>
      </View>

      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={authStart.isPending ? 'OPENING BUNGIE…' : 'SIGN IN WITH BUNGIE'}
            tone="solid"
            disabled={!online || authStart.isPending}
            onPress={signIn}
          />
        </View>
        <Body size={12} color={Ghost.dim} style={{ textAlign: 'center', lineHeight: 17 }}>
          {online
            ? 'Sign-in happens in the browser. The server keeps the tokens; the app never sees them.'
            : 'Run `ghost start` on the server and scan its QR code with the camera to connect.'}
        </Body>
        <Pressable hitSlop={12} style={styles.server} onPress={() => router.push('/settings')}>
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <Meta color={status.color}>{status.label}</Meta>
          <Meta color={Ghost.accent}>Change ›</Meta>
        </Pressable>
        <Mono style={{ letterSpacing: 0, textAlign: 'center' }}>
          {serverUrl.replace(/^https?:\/\//, '')}
        </Mono>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Ghost.bg, paddingHorizontal: 24 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  server: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
