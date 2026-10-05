import type { GuardianCharacter } from "@ghost/contract"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Chevron, Cond, Cut, Diamond } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"

// Colour of the header glow behind the power control, so its cut corners
// blend in (see Cut).
const UNDER_GLOW = "#111418"

/** The only chrome in the app: the Ghost mark, and your power, which opens the menu. */
export function ChatHeader({
  character,
  ruled,
  onMenu,
}: {
  character: GuardianCharacter | undefined
  ruled: boolean
  onMenu: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingBottom: 12,
        paddingLeft: 20,
        paddingRight: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottomWidth: ruled ? 1 : 0,
        borderBottomColor: Ghost.headerRule,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Diamond size={9} />
        <Cond size={19} style={{ letterSpacing: 3 }}>
          GHOST
        </Cond>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        hitSlop={8}
        onPress={onMenu}
      >
        <Cut
          fill={Ghost.panel}
          border={Ghost.line}
          under={ruled ? Ghost.bg : UNDER_GLOW}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 6,
            paddingHorizontal: 10,
          }}
        >
          <Diamond size={12} color={Ghost.ink} outline />
          <Cond size={18} color={Ghost.gold} style={{ letterSpacing: 0.7, lineHeight: 20 }}>
            {character?.light ?? "—"}
          </Cond>
          <View style={{ marginTop: -3, marginHorizontal: 2 }}>
            <Chevron direction="down" color={Ghost.muted} />
          </View>
        </Cut>
      </Pressable>
    </View>
  )
}
