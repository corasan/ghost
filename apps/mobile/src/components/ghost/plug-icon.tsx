import { Image } from 'expo-image'

import { Ghost } from '@/constants/theme'

/** An aspect, fragment or mod icon from the game, on a swatch so a missing image keeps its space. */
export function PlugIcon({ icon, size }: { icon: string | null | undefined; size: number }) {
  return (
    <Image
      source={icon ?? undefined}
      style={{ width: size, height: size, backgroundColor: Ghost.swatch }}
      transition={120}
    />
  )
}
