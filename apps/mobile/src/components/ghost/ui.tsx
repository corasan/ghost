import { Image } from "expo-image"
import type { ReactNode } from "react"
import { Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View } from "react-native"

import { Ghost, Rarity, Type } from "@/constants/theme"

export function Mono({
  children,
  size = 10,
  color = Ghost.muted,
  style,
}: {
  children: ReactNode
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text
      style={[{ fontFamily: Type.mono, fontSize: size, color, letterSpacing: size * 0.1 }, style]}
    >
      {children}
    </Text>
  )
}

export function Diamond({
  size,
  filled = true,
  color = Ghost.accent,
}: {
  size: number
  filled?: boolean
  color?: string
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        transform: [{ rotate: "45deg" }],
        backgroundColor: filled ? color : undefined,
        borderWidth: filled ? 0 : 1.5,
        borderColor: color,
      }}
    />
  )
}

// The item's icon framed in its rarity colour. Falls back to a flat tile
// when the manifest has no icon.
export function Swatch({
  rarity = "unknown",
  size,
  bar,
  icon,
}: {
  rarity?: Rarity
  size: number
  bar?: boolean
  icon?: string | null
}) {
  const tone = Rarity[rarity]
  return (
    <Image
      source={icon ?? undefined}
      style={[
        { width: size, height: size, backgroundColor: tone.fill, borderColor: tone.color },
        bar ? { borderLeftWidth: 3 } : { borderWidth: 1 },
      ]}
    />
  )
}

export function Check({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderWidth: 1.5,
        borderColor: on ? Ghost.accent : Ghost.muted,
        backgroundColor: on ? Ghost.accent : undefined,
      }}
    />
  )
}

export function Banner({
  text,
  action,
  onPress,
}: {
  text: string
  action?: string
  onPress?: () => void
}) {
  return (
    <Pressable onPress={onPress} style={styles.banner}>
      <Diamond size={8} />
      <Text style={styles.bannerText}>
        {text}
        {action ? <Text style={{ color: Ghost.accent }}> {action} →</Text> : null}
      </Text>
    </Pressable>
  )
}

export function StatRow({
  stats,
  size = 18,
}: {
  stats: readonly { readonly label: string; readonly value: number }[]
  size?: number
}) {
  return (
    <View style={{ flexDirection: "row" }}>
      {stats.map((stat) => (
        <View key={stat.label} style={{ flex: 1, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: Type.medium,
              fontSize: size,
              color: Ghost.text,
            }}
          >
            {stat.value}
          </Text>
          <Mono size={9}>{stat.label}</Mono>
        </View>
      ))}
    </View>
  )
}

export function ActionButton({
  label,
  onPress,
  tone = "outline",
  flex = 1,
}: {
  label: string
  onPress?: () => void
  tone?: "outline" | "accent" | "danger"
  flex?: number
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.button,
        { flex },
        tone === "outline" && { borderWidth: 1, borderColor: Ghost.lineStrong },
        tone === "accent" && { backgroundColor: Ghost.accent },
        tone === "danger" && { backgroundColor: Ghost.danger },
      ]}
    >
      <Text
        style={{
          fontSize: 14,
          fontFamily: tone === "outline" ? Type.regular : Type.semibold,
          color: tone === "outline" ? Ghost.textSoft : tone === "accent" ? Ghost.onAccent : "#fff",
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Ghost.card,
    borderWidth: 1,
    borderColor: "rgba(79,163,227,0.35)",
  },
  bannerText: {
    flex: 1,
    fontFamily: Type.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Ghost.textSoft,
  },
  button: { padding: 14, borderRadius: 10, alignItems: "center" },
})
