// Design tokens lifted from "Ghost - App Map". The app is dark only, like
// the design: the game's UI is dark and the item tier colors only read
// correctly on a near-black background.
export const colors = {
  bg: "#0b0d10",
  surface: "#15191f",
  text: "#e8ecf1",
  text2: "#c5ccd6",
  text3: "#aab3bf",
  dim: "#8a94a3",
  muted: "#5b6472",
  accent: "#4FA3E3",
  accentInk: "#06111a",
  power: "#F2B01E",
  green: "#7DD3A8",
  red: "#E05C4B",
  exotic: "#CEAE33",
  legendary: "#A365D6",
  rare: "#5A8FD6",
  common: "#8a94a3",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  hairline: "rgba(255,255,255,0.07)",
  accentBorder: "rgba(79,163,227,0.35)",
} as const

export const fonts = {
  light: "Outfit_300Light",
  regular: "Outfit_400Regular",
  medium: "Outfit_500Medium",
  semibold: "Outfit_600SemiBold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const

export const tierColor = (tier: "exotic" | "legendary" | "rare" | "common" | "unknown") =>
  tier === "exotic"
    ? colors.exotic
    : tier === "legendary"
      ? colors.legendary
      : tier === "rare"
        ? colors.rare
        : colors.common

// The striped placeholder swatches in the design use a dark tint of the
// tier color; we approximate the stripes with a flat tinted fill.
export const tierFill = (tier: "exotic" | "legendary" | "rare" | "common" | "unknown") =>
  tier === "exotic"
    ? "#2a2410"
    : tier === "legendary"
      ? "#1c1526"
      : tier === "rare"
        ? "#141d29"
        : "#1a1e24"
