import type { ItemTier } from "@ghost/contract"
import { Image } from "expo-image"
import { router } from "expo-router"
import type { ReactNode } from "react"
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Ghost, Gutter, Rarity, Type } from "@/constants/theme"

// The design's three voices: JetBrains Mono for labels and numbers that are
// data, Barlow Condensed for headings and buttons, Barlow for sentences.
// Letter spacing is specified in em in the design, so it scales with size.

type TextProps = {
  children: ReactNode
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
  lines?: number
}

export function Mono({ children, size = 9, color = Ghost.dim, style, lines }: TextProps) {
  return (
    <Text
      numberOfLines={lines}
      style={[{ fontFamily: Type.mono, fontSize: size, color, letterSpacing: size * 0.12 }, style]}
    >
      {children}
    </Text>
  )
}

export function Cond({ children, size = 15, color = Ghost.ink, style, lines }: TextProps) {
  return (
    <Text
      numberOfLines={lines}
      style={[{ fontFamily: Type.cond, fontSize: size, color, letterSpacing: size * 0.1 }, style]}
    >
      {children}
    </Text>
  )
}

export function Body({ children, size = 15, color = Ghost.ink, style, lines }: TextProps) {
  return (
    <Text
      numberOfLines={lines}
      style={[{ fontFamily: Type.body, fontSize: size, lineHeight: size * 1.4, color }, style]}
    >
      {children}
    </Text>
  )
}

export function Diamond({
  size,
  color = Ghost.accent,
  outline = false,
}: {
  size: number
  color?: string
  outline?: boolean
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        transform: [{ rotate: "45deg" }],
        backgroundColor: outline ? undefined : color,
        borderWidth: outline ? 1.5 : 0,
        borderColor: color,
      }}
    />
  )
}

/** The "›" and "⌄" marks in the design are rotated half-borders, not glyphs. */
export function Chevron({
  direction = "right",
  size = 7,
  color = Ghost.dim,
}: {
  direction?: "right" | "down" | "left"
  size?: number
  color?: string
}) {
  const rotate = direction === "right" ? "45deg" : direction === "down" ? "135deg" : "225deg"
  return (
    <View
      style={{
        width: size,
        height: size,
        borderTopWidth: 1.5,
        borderRightWidth: 1.5,
        borderColor: color,
        transform: [{ rotate }],
      }}
    />
  )
}

/**
 * A box with its top-left and bottom-right corners cut at 45°, the design's
 * signature shape. React Native has no clip-path, so each cut corner is a
 * square rotated 45° and centred on the corner, painted in the colour behind
 * the box; its edge draws the diagonal. `under` must match that colour.
 */
export function Cut({
  cut = 6,
  fill,
  border,
  under = Ghost.bg,
  style,
  children,
}: {
  cut?: number
  fill?: string
  border?: string
  under?: string
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}) {
  const inset = border ? 1 : 0
  const side = cut * Math.SQRT2
  const corner = {
    position: "absolute",
    width: side,
    height: side,
    backgroundColor: under,
    borderWidth: inset,
    borderColor: border,
    transform: [{ rotate: "45deg" }],
  } as const
  return (
    <View
      style={[
        { backgroundColor: fill, borderWidth: inset, borderColor: border, overflow: "hidden" },
        style,
      ]}
    >
      {children}
      <View
        pointerEvents="none"
        style={[corner, { top: -inset - side / 2, left: -inset - side / 2 }]}
      />
      <View
        pointerEvents="none"
        style={[corner, { bottom: -inset - side / 2, right: -inset - side / 2 }]}
      />
    </View>
  )
}

export function Button({
  label,
  onPress,
  tone = "outline",
  flex = 1,
  disabled,
  under = Ghost.bg,
  compact,
}: {
  label: string
  onPress?: () => void
  tone?: "outline" | "solid" | "danger" | "accent"
  flex?: number
  disabled?: boolean
  under?: string
  compact?: boolean
}) {
  const solid = tone === "solid" || tone === "danger"
  const fill = tone === "solid" ? Ghost.ink : tone === "danger" ? Ghost.danger : undefined
  const border = solid ? undefined : tone === "accent" ? Ghost.accent : Ghost.ruleStrong
  const color = solid ? Ghost.bg : tone === "accent" ? Ghost.accent : Ghost.ink
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [{ flex, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Cut
        cut={solid ? 8 : 6}
        fill={fill}
        border={border}
        under={under}
        style={{
          paddingVertical: compact ? 9 : 12,
          paddingHorizontal: 14,
          alignItems: "center",
        }}
      >
        <Cond size={compact ? 14 : 15} color={color}>
          {label}
        </Cond>
      </Cut>
    </Pressable>
  )
}

export function Chip({
  label,
  active,
  onPress,
  tone,
}: {
  label: string
  active: boolean
  onPress: () => void
  tone?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        active
          ? { backgroundColor: tone ?? Ghost.ink, borderColor: tone ?? Ghost.ink }
          : { borderColor: Ghost.ruleStrong },
      ]}
    >
      <Cond size={13} color={active ? Ghost.bg : Ghost.muted}>
        {label}
      </Cond>
    </Pressable>
  )
}

/** The chamfered tick box on plan and cleanup rows. */
export function Tick({ on, under = Ghost.panel }: { on: boolean; under?: string }) {
  return (
    <Cut
      cut={3}
      fill={on ? Ghost.accent : undefined}
      border={on ? Ghost.accent : Ghost.dim}
      under={under}
      style={{ width: 14, height: 14 }}
    />
  )
}

/** Item art with its rarity on the left edge. */
export function Swatch({
  tier,
  icon,
  size,
}: {
  tier: ItemTier
  icon?: string | null
  size: number
}) {
  return (
    <View
      style={{ width: size, height: size, backgroundColor: Ghost.swatch, flexDirection: "row" }}
    >
      <View style={{ width: 3, backgroundColor: Rarity[tier] }} />
      {icon ? (
        <Image source={icon} style={{ flex: 1 }} recyclingKey={icon} transition={120} />
      ) : null}
    </View>
  )
}

/** A stat as a number over ten ticks, one tick per ten points. */
export function TierStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  const color = highlight ? Ghost.good : Ghost.ink
  const lit = Math.min(10, Math.floor(value / 10))
  return (
    <View style={{ flex: 1 }}>
      <Cond size={20} color={color} style={{ letterSpacing: 0, lineHeight: 20 }}>
        {value}
      </Cond>
      <Mono size={8} style={{ marginTop: 3 }}>
        {label}
      </Mono>
      <View style={{ flexDirection: "row", gap: 2, marginTop: 6 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <View
            key={i}
            style={{ flex: 1, height: 3, backgroundColor: i < lit ? color : Ghost.line }}
          />
        ))}
      </View>
    </View>
  )
}

export function TierStats({
  stats,
}: {
  stats: readonly { readonly label: string; readonly value: number; readonly target?: boolean }[]
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {stats.map((stat) => (
        <TierStat key={stat.label} label={stat.label} value={stat.value} highlight={stat.target} />
      ))}
    </View>
  )
}

/** Ghost's voice: a blue rule beside a sentence. */
export function Said({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 2, backgroundColor: Ghost.accent }} />
      <Text
        style={{
          flex: 1,
          fontFamily: Type.body,
          fontSize: size,
          lineHeight: size * 1.45,
          color: Ghost.soft,
        }}
      >
        {children}
      </Text>
    </View>
  )
}

/** One Ghost suggestion at the bottom of a page that returns to chat with it queued. */
export function Nudge({ text, action, prompt }: { text: string; action: string; prompt: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.dismissTo({ pathname: "/", params: { draft: prompt } })}
      style={styles.nudge}
    >
      <View style={{ width: 2, alignSelf: "stretch", backgroundColor: Ghost.accent }} />
      <Body size={14} color={Ghost.soft} style={{ flex: 1, lineHeight: 19 }}>
        {text}
      </Body>
      <Cond size={14} color={Ghost.accent}>
        {action} ›
      </Cond>
    </Pressable>
  )
}

/**
 * Header shared by the menu pages: a way back to chat, a big condensed
 * title, and the page's one number on the right.
 */
export function PageHeader({
  title,
  subtitle,
  subtitleColor = Ghost.dim,
  figure,
  figureSuffix,
  figureColor = Ghost.ink,
  caption,
  children,
}: {
  title: string
  subtitle: string
  subtitleColor?: string
  figure: string | number
  figureSuffix?: string
  figureColor?: string
  caption: string
  children?: ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: insets.top + 14, paddingHorizontal: Gutter }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Ghost"
        hitSlop={14}
        onPress={() => router.back()}
        style={{ alignSelf: "flex-start" }}
      >
        <Mono size={10} color={Ghost.accent}>
          ‹ GHOST
        </Mono>
      </Pressable>
      <View style={styles.headerRow}>
        <View style={{ flexShrink: 1 }}>
          <Cond size={44} style={styles.headline} lines={1}>
            {title}
          </Cond>
          <Mono size={10} color={subtitleColor} style={{ marginTop: 8 }}>
            {subtitle}
          </Mono>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Cond size={44} color={figureColor} style={styles.headline}>
            {figure}
            {figureSuffix ? <Text style={{ color: Ghost.dim }}>{figureSuffix}</Text> : null}
          </Cond>
          <Mono size={10} style={{ marginTop: 8 }}>
            {caption}
          </Mono>
        </View>
      </View>
      {children}
    </View>
  )
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: Ghost.rule }, style]} />
}

const styles = StyleSheet.create({
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1 },
  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: Gutter,
    paddingVertical: 4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 14,
  },
  headline: { letterSpacing: 0.9, lineHeight: 42 },
})
