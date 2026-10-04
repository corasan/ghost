import type { Rarity } from "@/constants/theme"

// Example exchanges from the Ghost app map design. The server answers in
// plain text, so the Ghost tab shows these as prompts to try until it can
// return structured plans.

export interface Stat {
  readonly label: string
  readonly value: number
  readonly hit?: boolean
}

export interface PlanRow {
  readonly name: string
  readonly rarity: Rarity
  readonly meta: string
  readonly side: string
  readonly held?: boolean
}

export type Example =
  | {
      readonly kind: "build"
      readonly prompt: string
      readonly reply: string
      readonly title: string
      readonly aside: string
      readonly stats: readonly Stat[]
      readonly rows: readonly PlanRow[]
      readonly note: string
      readonly actions: readonly [string, string]
    }
  | {
      readonly kind: "roll"
      readonly prompt: string
      readonly reply: string
      readonly best: {
        readonly name: string
        readonly rarity: Rarity
        readonly meta: string
        readonly score: number
        readonly perks: readonly { readonly name: string; readonly hit: boolean }[]
        readonly bars: readonly Stat[]
      }
      readonly rest: readonly (PlanRow & { readonly score: number })[]
      readonly actions: readonly [string, string]
    }
  | {
      readonly kind: "plan"
      readonly prompt: string
      readonly reply: string
      readonly title: string
      readonly aside: string
      readonly rows: readonly PlanRow[]
      readonly more: string
      readonly note: string
      readonly actions: readonly [string, string]
    }

export const examples: readonly Example[] = [
  {
    kind: "build",
    prompt: "Void build, 100 Resilience, 100 Recovery, as much Discipline as possible",
    reply: "Reachable with Gyrfalcon's. Triple-100 isn't, but Discipline gets to 80. Three swaps:",
    title: "BUILD PLAN · 3 SWAPS",
    aside: "+2 MODS",
    stats: [
      { label: "MOB", value: 60 },
      { label: "RES", value: 100, hit: true },
      { label: "REC", value: 100, hit: true },
      { label: "DIS", value: 80, hit: true },
      { label: "INT", value: 30 },
      { label: "STR", value: 20 },
    ],
    rows: [
      {
        name: "Gyrfalcon's Hauberk",
        rarity: "exotic",
        meta: "CHEST · REPLACES IRON FORERUNNER",
        side: "VAULT",
      },
      {
        name: "Wild Hunt Mask",
        rarity: "legendary",
        meta: "HELMET · 68 TOTAL · REPLACES BAKRIS",
        side: "VAULT",
      },
      {
        name: "Lustrous Strides",
        rarity: "legendary",
        meta: "LEGS · REC SPIKE 30",
        side: "HUNTER",
      },
    ],
    note: "Mods: 2× Discipline (chest, legs). Fragments untouched.",
    actions: ["Save as loadout", "Apply build"],
  },
  {
    kind: "roll",
    prompt: "Best hand cannon I own for Trials?",
    reply: "12 hand cannons. Ranked for PvP — range, handling, and perk pairing:",
    best: {
      name: "Igneous Hammer",
      rarity: "legendary",
      meta: "LEGENDARY · 120 RPM · VAULT",
      score: 94,
      perks: [
        { name: "Rangefinder", hit: true },
        { name: "Eye of the Storm", hit: true },
        { name: "Range MW", hit: false },
      ],
      bars: [
        { label: "RANGE", value: 78, hit: true },
        { label: "STABIL", value: 51 },
        { label: "HANDL", value: 64 },
      ],
    },
    rest: [
      {
        name: "Hawkmoon",
        rarity: "exotic",
        meta: "EXOTIC · OPENING SHOT · USES EXOTIC SLOT",
        side: "",
        score: 88,
      },
      {
        name: "Round Robin",
        rarity: "legendary",
        meta: "HIP-FIRE GRIP · ADAGIO",
        side: "",
        score: 61,
      },
    ],
    actions: ["Compare all 12", "Equip on Hunter"],
  },
  {
    kind: "plan",
    prompt: "Empty the postmaster into the vault",
    reply: "9 items on Hunter; vault has 41 free. Plan below — tap a row to hold it back.",
    title: "PLAN · 9 ITEMS",
    aside: "8 SELECTED",
    rows: [
      {
        name: "Cataphract GL3",
        rarity: "legendary",
        meta: "GRENADE LAUNCHER → VAULT",
        side: "2008",
      },
      {
        name: "Gyrfalcon's Hauberk",
        rarity: "exotic",
        meta: "CHEST · 68 TOTAL → VAULT",
        side: "2004",
      },
      { name: "Enhancement Prism ×3", rarity: "rare", meta: "MATERIAL → INVENTORY", side: "—" },
      { name: "Taipan-4fr", rarity: "rare", meta: "DUPLICATE · HELD", side: "1990", held: true },
    ],
    more: "+ 5 MORE · ALL SELECTED",
    note: "Pulled items will be pinned in Recent.",
    actions: ["Hold all", "Move 8 to vault"],
  },
]
