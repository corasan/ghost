import type { SetBonus } from "@ghost/contract"
import { useRef, useState } from "react"
import { type HostInstance, Pressable, StyleSheet, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { Tooltip } from "@/components/ghost/tooltip"
import { Body, Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { setBonusLine } from "@/lib/plan-card"

const ICON = 24
const ICON_GAP = 8
const LABEL_WIDTH = 72
const LABEL_GAP = 10

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
 * The build's set bonuses as icons; tapping one floats a tip pointing at it,
 * and any touch outside the tip closes it.
 */
export function SetBonusIcons({ bonuses }: { bonuses: readonly SetBonus[] }) {
  const anchors = useRef<(HostInstance | null)[]>([])
  const [open, setOpen] = useState<{ index: number; anchor: HostInstance }>()
  const shown = open && bonuses[open.index]
  return (
    <View style={styles.row}>
      <Mono style={styles.label}>SET BONUS</Mono>
      {bonuses.map((bonus, i) => (
        <Pressable
          key={`${bonus.set}${bonus.name}`}
          ref={(view) => {
            anchors.current[i] = view
          }}
          accessibilityRole="button"
          accessibilityLabel={bonus.name}
          accessibilityHint="Shows what the set bonus does"
          accessibilityState={{ expanded: open?.index === i }}
          hitSlop={6}
          onPress={() => {
            const anchor = anchors.current[i]
            if (anchor) setOpen({ index: i, anchor })
          }}
          style={({ pressed }) => [
            open?.index === i && { boxShadow: `0 0 0 1px ${Ghost.accent}` },
            pressed && { opacity: 0.6 },
          ]}
        >
          <PlugIcon icon={bonus.icon} size={ICON} />
        </Pressable>
      ))}
      {open && shown ? (
        <Tooltip key={open.index} anchor={open.anchor} onClose={() => setOpen(undefined)}>
          <SetBonusText bonus={shown} />
        </Tooltip>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: ICON_GAP },
  label: { width: LABEL_WIDTH, marginRight: LABEL_GAP - ICON_GAP },
})
