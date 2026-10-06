import type { SubclassLoadout } from "@ghost/contract"
import { Image } from "expo-image"
import { View } from "react-native"

import { Diamond } from "@/components/ghost/ui"
import { ELEMENT_TONE } from "@/constants/theme"

/** The subclass's emblem from the game, or a diamond in its element's colour when there is none. */
export function SubclassMark({
  loadout,
  size,
}: {
  loadout: Pick<SubclassLoadout, "icon" | "element">
  size: number
}) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {loadout.icon ? (
        <Image
          source={loadout.icon}
          style={{ width: size, height: size }}
          contentFit="contain"
          transition={120}
        />
      ) : (
        <Diamond size={Math.round(size * 0.42)} color={ELEMENT_TONE[loadout.element]} />
      )}
    </View>
  )
}
