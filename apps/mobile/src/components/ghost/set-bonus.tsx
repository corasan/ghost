import type { SetBonus } from "@ghost/contract"
import { useRef, useState } from "react"
import { type HostInstance, Pressable, StyleSheet, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { Tooltip } from "@/components/ghost/tooltip"
import { Body, Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { setBonusLine, splitSetBonuses } from "@/lib/plan-card"

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
      <Mono size={11} color={Ghost.accent} style={{ letterSpacing: 1, marginTop: 3 }}>
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
 * The build's set bonuses as icons, the ones it is short of dimmed after the
 * ones it turns on; tapping one floats a tip pointing at it, and any touch
 * outside the tip closes it.
 */
export function SetBonusIcons({ bonuses }: { bonuses: readonly SetBonus[] }) {
  const anchors = useRef(new Map<SetBonus, HostInstance>())
  const [open, setOpen] = useState<{ bonus: SetBonus; anchor: HostInstance }>()
  const { on, short } = splitSetBonuses(bonuses)
  const icon = (bonus: SetBonus, isShort: boolean) => (
    <Pressable
      key={`${bonus.set}${bonus.name}`}
      ref={(view) => {
        if (view) anchors.current.set(bonus, view)
        else anchors.current.delete(bonus)
      }}
      accessibilityRole="button"
      accessibilityLabel={isShort ? `${bonus.name}, ${setBonusLine(bonus)}` : bonus.name}
      accessibilityHint="Shows what the set bonus does"
      accessibilityState={{ expanded: open?.bonus === bonus }}
      hitSlop={6}
      onPress={() => {
        const anchor = anchors.current.get(bonus)
        if (anchor) setOpen({ bonus, anchor })
      }}
      style={({ pressed }) => [
        isShort && styles.short,
        open?.bonus === bonus && { boxShadow: `0 0 0 1px ${Ghost.accent}` },
        pressed && { opacity: 0.6 },
      ]}
    >
      <PlugIcon icon={bonus.icon} size={ICON} />
    </Pressable>
  )
  return (
    <View style={styles.row}>
      <Mono style={styles.label}>SET BONUS</Mono>
      {on.map((bonus) => icon(bonus, false))}
      {short.map((bonus) => icon(bonus, true))}
      {open ? (
        <Tooltip
          key={`${open.bonus.set}${open.bonus.name}`}
          anchor={open.anchor}
          onClose={() => setOpen(undefined)}
        >
          <SetBonusText bonus={open.bonus} />
        </Tooltip>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: ICON_GAP },
  label: { width: LABEL_WIDTH, marginRight: LABEL_GAP - ICON_GAP },
  short: {
    opacity: 0.45,
    padding: 1,
    margin: -2,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Ghost.muted,
  },
})
