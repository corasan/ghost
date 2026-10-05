import type { ItemTier } from "@ghost/contract"

// Tokens from "Ghost - App Map v2": near-black surfaces, warm off-white ink,
// one blue accent, gold for power, and chamfered corners instead of radii.

export const Ghost = {
  bg: "#0c0d0f",
  /** The faint glow behind the chat header and page titles. */
  glow: "radial-gradient(120% 50% at 50% -8%, #151a21 0%, #0c0d0f 60%)",
  panel: "#121418",
  swatch: "#181b20",
  line: "#23272e",
  rule: "#1e2228",
  ruleStrong: "#2c313a",
  headerRule: "#1a1d22",
  ink: "#ecebe6",
  soft: "#d6d9dd",
  muted: "#a7adb5",
  dim: "#6b7280",
  accent: "#5aa9e6",
  gold: "#e3b341",
  good: "#7dd3a8",
  danger: "#e06a5a",
  scrim: "rgba(6,7,9,0.72)",
} as const

export const Rarity = {
  exotic: "#ceae33",
  legendary: "#a365d6",
  rare: "#5a8fd6",
  common: "#6b7280",
  unknown: "#6b7280",
} as const satisfies Record<ItemTier, string>

export const Type = {
  body: "Barlow_400Regular",
  bodyMedium: "Barlow_500Medium",
  bodySemi: "Barlow_600SemiBold",
  cond: "BarlowCondensed_600SemiBold",
  condMedium: "BarlowCondensed_500Medium",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const

/** Horizontal page padding used by every screen in the design. */
export const Gutter = 20
