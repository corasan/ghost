import * as Updates from 'expo-updates'
import { useEffect, useState } from 'react'
import { AppState, Pressable, StyleSheet, View } from 'react-native'
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Body, Cond, Cut } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'

const live = Updates.isEnabled && !__DEV__

/**
 * Offers to restart once an update has downloaded. expo-updates fetches one
 * on launch by itself; this also checks each time the app comes back to the
 * foreground, so a long-lived session still hears about new releases.
 */
export function UpdateBanner() {
  const { isUpdatePending, isChecking, isDownloading } = Updates.useUpdates()
  const [dismissed, setDismissed] = useState(false)
  const insets = useSafeAreaInsets()
  const busy = isChecking || isDownloading || isUpdatePending

  useEffect(() => {
    if (!live || busy) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        // Offline or a server hiccup: the next foreground tries again.
        .catch(() => {})
    })
    return () => sub.remove()
  }, [busy])

  if (!live || !isUpdatePending || dismissed) return null

  return (
    <Animated.View
      entering={SlideInUp.springify().damping(18)}
      exiting={SlideOutUp}
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <Cut fill={Ghost.panel} border={Ghost.ruleStrong} under={Ghost.bg} style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Update ready. Restart to update."
          onPress={() => Updates.reloadAsync().catch(() => {})}
          style={({ pressed }) => [styles.main, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.bar} />
          <Body size={14} color={Ghost.soft} style={styles.text}>
            Update ready
          </Body>
          <Cond size={14} color={Ghost.accent}>
            Restart ›
          </Cond>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          onPress={() => setDismissed(true)}
          style={({ pressed }) => [styles.close, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Cond size={16} color={Ghost.dim}>
            ×
          </Cond>
        </Pressable>
      </Cut>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 100 },
  card: { flexDirection: 'row', alignItems: 'center' },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
  },
  bar: { width: 2, alignSelf: 'stretch', backgroundColor: Ghost.accent },
  text: { flex: 1, lineHeight: 19 },
  close: { paddingVertical: 12, paddingHorizontal: 14 },
})
