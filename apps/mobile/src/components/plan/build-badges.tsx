import type { InGameState, SavedBuild } from '@ghost/contract'
import { StyleSheet, View } from 'react-native'

import { Meta } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'

const DRIFT: Record<InGameState, string | null> = {
  synced: null,
  game_changed: 'Slot changed',
  build_changed: 'Edited since saved',
  diverged: 'Out of sync',
  cleared: 'Slot cleared',
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Meta size={12} color={color}>
        {label}
      </Meta>
    </View>
  )
}

export function BuildBadges({ build }: { build: SavedBuild }) {
  const readiness = build.readiness
  const missing = readiness?.missing.length ?? 0
  const drift = readiness?.inGame ? DRIFT[readiness.inGame] : null
  const badges = [
    build.inGame
      ? { label: `In game · slot ${build.inGame.index + 1}`, color: Ghost.accent }
      : null,
    missing > 0 ? { label: `${missing} missing`, color: Ghost.danger } : null,
    readiness?.pastArtifact ? { label: 'Past artifact', color: Ghost.gold } : null,
    drift ? { label: drift, color: Ghost.gold } : null,
  ].filter((badge) => badge !== null)
  if (badges.length === 0) return null
  return (
    <View style={styles.badges}>
      {badges.map((badge) => (
        <Badge key={badge.label} label={badge.label} color={badge.color} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
})
