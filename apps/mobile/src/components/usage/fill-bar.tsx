import { View } from 'react-native'

import { Ghost } from '@/constants/theme'

/** Calm until a meter is worth watching, then gold, then red near the cap. */
export const fillTone = (share: number) =>
  share >= 0.9 ? Ghost.danger : share >= 0.75 ? Ghost.gold : Ghost.accent

export function FillBar({ share, height = 4 }: { share: number; height?: number }) {
  const clamped = Math.min(1, Math.max(0, share))
  return (
    <View style={{ height, backgroundColor: Ghost.ruleStrong }}>
      <View style={{ width: `${clamped * 100}%`, height, backgroundColor: fillTone(clamped) }} />
    </View>
  )
}
