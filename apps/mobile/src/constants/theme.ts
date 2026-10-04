/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from "react-native"

export const Colors = {
  light: {
    text: "#000000",
    background: "#ffffff",
    backgroundElement: "#F0F0F3",
    backgroundSelected: "#E0E1E6",
    textSecondary: "#60646C",
  },
  dark: {
    text: "#ffffff",
    background: "#000000",
    backgroundElement: "#212225",
    backgroundSelected: "#2E3135",
    textSecondary: "#B0B4BA",
  },
} as const

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
})

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0
export const MaxContentWidth = 800

// Palette and type from the Ghost app map design. The app is dark only.
export const Ghost = {
  bg: "#0b0d10",
  card: "#15191f",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  accentLine: "rgba(79,163,227,0.4)",
  text: "#e8ecf1",
  textSoft: "#c5ccd6",
  muted: "#8a94a3",
  dim: "#5b6472",
  accent: "#4FA3E3",
  onAccent: "#06111a",
  power: "#F2B01E",
  good: "#7DD3A8",
  danger: "#E05C4B",
} as const

export const Rarity = {
  exotic: { color: "#CEAE33", fill: "#3a3118" },
  legendary: { color: "#A365D6", fill: "#2a1f36" },
  rare: { color: "#5A8FD6", fill: "#1c2838" },
} as const
export type Rarity = keyof typeof Rarity

export const Type = {
  light: "Outfit_300Light",
  regular: "Outfit_400Regular",
  medium: "Outfit_500Medium",
  semibold: "Outfit_600SemiBold",
  mono: "JetBrainsMono_400Regular",
} as const
