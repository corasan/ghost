import type { DamageType } from "@ghost/contract"
import { Image } from "expo-image"
import { View } from "react-native"

import { Cond } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { useGuardian } from "@/lib/api"

const MARK_SURFACE = "rgba(10,11,13,0.88)"
const ELEMENT_HALO = "rgba(10,11,13,0.8)"
const MAX_TIER = 5
const TIER_TONE = new Map([
  [5, Ghost.gold],
  [4, "#a365d6"],
])

/** Sizes of the marks for an icon drawn at `size` points; they scale with it. */
const marks = (size: number, hasPower: boolean) => {
  const inset = size >= 70 ? 6 : 4
  const bar = hasPower ? Math.round(Math.max(13, size * 0.27)) : 0
  const pipGap = size < 50 ? 1 : 2
  return {
    inset,
    glyph: Math.max(12, Math.round(size * 0.26)),
    bar,
    barText: Math.round(bar * 0.74),
    barGlyph: Math.round(bar * 0.62),
    barGap: Math.max(2, Math.round(bar * 0.2)),
    pip: Math.min(
      14,
      Math.max(4, Math.floor(size * 0.105)),
      Math.floor((size - bar - 2 * inset - (MAX_TIER - 1) * pipGap) / MAX_TIER),
    ),
    pipGap,
    frame: size >= 70 ? 2 : 1.5,
    scrim: Math.round(size * 0.3),
  }
}

function Pip({ size, color }: { size: number; color: string }) {
  const side = size / Math.SQRT2
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: side,
          height: side,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  )
}

/**
 * The one icon used wherever an item appears. Each mark owns an edge: gear
 * tier as diamonds up the left, the damage type's icon bottom-right, and a gold frame
 * once masterworked. Pass `power` where no row prints it beside the icon and
 * it moves into a bar along the bottom, taking the damage type with it.
 */
export function ItemIcon({
  icon,
  size,
  fill = false,
  element = "none",
  gearTier,
  masterwork = false,
  power,
}: {
  icon?: string | null
  /** The size the marks are drawn for, and the box itself unless `fill` is set. */
  size: number
  /** Stretch to the width of the column instead of `size`. */
  fill?: boolean
  element?: DamageType
  gearTier?: number | null
  masterwork?: boolean
  power?: number | null
}) {
  const elementIcon = useGuardian().data?.elementIcons?.[element]
  const hasPower = power !== undefined && power !== null
  const m = marks(size, hasPower)
  const tier = Math.max(0, Math.min(MAX_TIER, gearTier ?? 0))
  return (
    <View
      style={{
        width: fill ? "100%" : size,
        aspectRatio: 1,
        backgroundColor: Ghost.swatch,
        overflow: "hidden",
      }}
    >
      <Image source={icon} style={{ flex: 1 }} recyclingKey={icon} transition={120} />
      {tier > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: m.scrim,
            backgroundImage: "linear-gradient(to right, rgba(10,11,13,0.8), rgba(10,11,13,0))",
          }}
        />
      ) : null}
      {elementIcon && !hasPower ? (
        <View
          style={{
            position: "absolute",
            right: m.inset,
            bottom: m.inset,
            borderRadius: m.glyph,
            backgroundColor: ELEMENT_HALO,
            boxShadow: `0 0 ${Math.round(m.glyph / 2)}px ${Math.round(m.glyph / 3.5)}px ${ELEMENT_HALO}`,
          }}
        >
          <Image source={elementIcon} style={{ width: m.glyph, height: m.glyph }} />
        </View>
      ) : null}
      {hasPower ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: m.bar,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: m.barGap,
            paddingRight: m.inset,
            backgroundColor: MARK_SURFACE,
            borderTopWidth: 1,
            borderTopColor: Ghost.ruleStrong,
          }}
        >
          {elementIcon ? (
            <Image source={elementIcon} style={{ width: m.barGlyph, height: m.barGlyph }} />
          ) : null}
          <Cond
            size={m.barText}
            color={masterwork ? Ghost.gold : Ghost.ink}
            style={{ letterSpacing: m.barText * 0.02, lineHeight: m.barText }}
          >
            {power}
          </Cond>
        </View>
      ) : null}
      {masterwork ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderWidth: m.frame,
            borderColor: Ghost.gold,
            boxShadow: "inset 0 0 8px rgba(227,179,65,0.35)",
          }}
        />
      ) : null}
      {tier > 0 ? (
        <View
          style={{
            position: "absolute",
            left: m.inset,
            bottom: m.inset + m.bar,
            flexDirection: "column-reverse",
            gap: m.pipGap,
          }}
        >
          {Array.from({ length: tier }, (_, i) => (
            <Pip key={i} size={m.pip} color={TIER_TONE.get(tier) ?? Ghost.ink} />
          ))}
        </View>
      ) : null}
    </View>
  )
}
