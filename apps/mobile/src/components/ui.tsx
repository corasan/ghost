import type { ItemSummary } from "@ghost/contract"
import { Image } from "expo-image"
import type { ReactNode } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { colors, fonts, tierColor, tierFill } from "@/theme"

// Small typographic building blocks shared by every screen. The design uses
// two voices: Outfit for anything a person reads, JetBrains Mono (small,
// uppercase, letter-spaced) for labels and numbers.

export function Mono({
  size = 10,
  color = colors.dim,
  tracking = 1,
  style,
  children,
  ...rest
}: TextProps & { size?: number; color?: string; tracking?: number }) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fonts.mono,
          fontSize: size,
          color,
          letterSpacing: tracking,
          lineHeight: size * 1.4,
        },
        style,
      ]}
    >
      {children}
    </Text>
  )
}

export function Body({
  size = 14,
  color = colors.text,
  weight = "regular",
  style,
  children,
  ...rest
}: TextProps & { size?: number; color?: string; weight?: keyof typeof fonts }) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: fonts[weight], fontSize: size, color, lineHeight: size * 1.35 }, style]}
    >
      {children}
    </Text>
  )
}

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text
      style={[
        {
          fontFamily: fonts.semibold,
          fontSize: 30,
          color: colors.text,
          letterSpacing: -0.6,
          lineHeight: 33,
        },
        style,
      ]}
    >
      {children}
    </Text>
  )
}

/** Page header: a mono eyebrow over a large title, with a right slot. */
export function Header({
  eyebrow,
  eyebrowColor = colors.dim,
  title,
  right,
  onPressEyebrow,
}: {
  eyebrow?: string
  eyebrowColor?: string
  title: string
  right?: ReactNode
  onPressEyebrow?: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={{ flexShrink: 1 }}>
        {eyebrow ? (
          <Pressable onPress={onPressEyebrow} disabled={!onPressEyebrow} hitSlop={8}>
            <Mono color={eyebrowColor} tracking={1.2}>
              {eyebrow}
            </Mono>
          </Pressable>
        ) : null}
        <Title style={{ marginTop: eyebrow ? 4 : 0 }}>{title}</Title>
      </View>
      {right}
    </View>
  )
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string
  active?: boolean
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
    >
      <Text
        style={{
          fontFamily: active ? fonts.medium : fonts.regular,
          fontSize: 12,
          color: active ? colors.bg : colors.text2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function Diamond({
  size = 10,
  glow,
  hollow,
}: {
  size?: number
  glow?: boolean
  hollow?: boolean
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        transform: [{ rotate: "45deg" }],
        backgroundColor: hollow ? "transparent" : colors.accent,
        borderWidth: hollow ? 1.5 : 0,
        borderColor: colors.muted,
        shadowColor: colors.accent,
        shadowOpacity: glow ? 1 : 0,
        shadowRadius: glow ? 8 : 0,
      }}
    />
  )
}

/** The "Ghost has something to say" banner: accent-bordered card with a diamond. */
export function GhostBanner({
  children,
  action,
  onPress,
  style,
}: {
  children: ReactNode
  action?: string
  onPress?: () => void
  style?: ViewStyle
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.banner, style]}>
      <View style={{ paddingTop: 5 }}>
        <Diamond size={8} />
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily: fonts.regular,
          fontSize: 13,
          lineHeight: 17,
          color: colors.text2,
        }}
      >
        {children}
        {action ? <Text style={{ color: colors.accent }}> {action} →</Text> : null}
      </Text>
    </Pressable>
  )
}

/** Item art: the Bungie icon when the manifest has one, else a tier-tinted square. */
export function Swatch({
  item,
  size = 48,
  radius = 0,
}: {
  item: Pick<ItemSummary, "tier" | "icon">
  size?: number
  radius?: number
}) {
  const border = tierColor(item.tier)
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: tierFill(item.tier),
        overflow: "hidden",
      }}
    >
      {item.icon ? (
        <Image source={{ uri: item.icon }} style={{ width: "100%", height: "100%" }} />
      ) : null}
    </View>
  )
}

export function Button({
  label,
  onPress,
  tone = "outline",
  flex = 1,
  disabled,
  busy,
}: {
  label: string
  onPress?: () => void
  tone?: "outline" | "accent" | "danger" | "ghost"
  flex?: number
  disabled?: boolean
  busy?: boolean
}) {
  const bg = tone === "accent" ? colors.accent : tone === "danger" ? colors.red : "transparent"
  const fg =
    tone === "accent"
      ? colors.accentInk
      : tone === "danger"
        ? "#fff"
        : tone === "ghost"
          ? colors.dim
          : colors.text2
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { flex, backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        tone === "outline" ? { borderWidth: 1, borderColor: colors.borderStrong } : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={{
            fontFamily: tone === "outline" || tone === "ghost" ? fonts.regular : fonts.semibold,
            fontSize: 14,
            color: fg,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: colors.border }, style]} />
}

export function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 }}>
      {children}
    </View>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <Centered>
      <ActivityIndicator color={colors.accent} />
      {label ? <Mono>{label.toUpperCase()}</Mono> : null}
    </Centered>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
  },
  chip: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999 },
  chipActive: { backgroundColor: colors.text },
  chipInactive: { borderWidth: 1, borderColor: colors.borderStrong },
  banner: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
})
