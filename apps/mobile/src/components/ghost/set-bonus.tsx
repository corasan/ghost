import type { SetBonus } from "@ghost/contract"
import { useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { Body, Cut, Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { setBonusLine } from "@/lib/plan-card"

const ICON = 24
const ICON_GAP = 8
const LABEL_WIDTH = 72
const LABEL_GAP = 10
const CARET = 9

/** A set bonus's name, the pieces it needs, and what it does. */
export function SetBonusText({ bonus, size = 13 }: { bonus: SetBonus; size?: number }) {
  return (
    <>
      <Body size={size + 1} style={{ fontFamily: Type.bodyMedium, lineHeight: size + 5 }}>
        {bonus.name}
      </Body>
      <Mono size={8} color={Ghost.accent} style={{ letterSpacing: 1, marginTop: 3 }}>
        {setBonusLine(bonus)}
      </Mono>
      {bonus.description ? (
        <Body size={size} color={Ghost.soft} style={{ lineHeight: size + 5, marginTop: 5 }}>
          {bonus.description}
        </Body>
      ) : null}
    </>
  )
}

/**
 * The build's active set bonuses as icons; tapping one opens a tip under the
 * row that points at it, tapping it again or the tip closes it.
 */
export function SetBonusIcons({
  bonuses,
  under = Ghost.panel,
}: {
  bonuses: readonly SetBonus[]
  under?: string
}) {
  const [open, setOpen] = useState<number>()
  const shown = open === undefined ? undefined : bonuses[open]
  return (
    <View>
      <View style={styles.row}>
        <Mono style={styles.label}>SET BONUS</Mono>
        {bonuses.map((bonus, i) => (
          <Pressable
            key={`${bonus.set}${bonus.name}`}
            accessibilityRole="button"
            accessibilityLabel={bonus.name}
            accessibilityHint="Shows what the set bonus does"
            accessibilityState={{ expanded: open === i }}
            hitSlop={6}
            onPress={() => setOpen((was) => (was === i ? undefined : i))}
            style={({ pressed }) => [
              open === i && { boxShadow: `0 0 0 1px ${Ghost.accent}` },
              pressed && { opacity: 0.6 },
            ]}
          >
            <PlugIcon icon={bonus.icon} size={ICON} />
          </Pressable>
        ))}
      </View>
      {shown && open !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Closes the set bonus"
          onPress={() => setOpen(undefined)}
          style={styles.tipSlot}
        >
          <Cut
            cut={6}
            fill={Ghost.swatch}
            border={Ghost.ruleStrong}
            under={under}
            style={styles.tip}
          >
            <SetBonusText bonus={shown} />
          </Cut>
          <View
            style={[
              styles.caret,
              { left: LABEL_WIDTH + LABEL_GAP + open * (ICON + ICON_GAP) + (ICON - CARET) / 2 },
            ]}
          />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: ICON_GAP },
  label: { width: LABEL_WIDTH, marginRight: LABEL_GAP - ICON_GAP },
  tipSlot: { marginTop: 10 },
  tip: { paddingVertical: 10, paddingHorizontal: 12 },
  caret: {
    position: "absolute",
    top: -CARET / 2 + 0.5,
    width: CARET,
    height: CARET,
    backgroundColor: Ghost.swatch,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: Ghost.ruleStrong,
    transform: [{ rotate: "45deg" }],
  },
})
