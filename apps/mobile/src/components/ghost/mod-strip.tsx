import { StyleSheet, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { Ghost } from "@/constants/theme"

export type StripMod = { name: string; icon?: string | null; swap?: boolean } | null

/** A piece's mods as a row of icons in socket order; null is an empty socket. */
export function ModStrip({ mods }: { mods: readonly StripMod[] }) {
  return (
    <View style={styles.row}>
      {mods.map((mod, i) =>
        mod ? (
          <View
            key={i}
            accessibilityLabel={mod.swap ? `${mod.name}, swapped in` : mod.name}
            style={[styles.slot, mod.swap && { borderColor: Ghost.accent }]}
          >
            <PlugIcon icon={mod.icon} size={22} />
          </View>
        ) : (
          <View key={i} accessibilityLabel="Free mod slot" style={styles.slot} />
        ),
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 4, marginTop: 5 },
  slot: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
    backgroundColor: Ghost.swatch,
  },
})
