import type { Rarity } from "@/constants/theme"

// Sample content from the Ghost app map design. The server has no endpoints
// for equipment, vault contents or structured plans yet, so the Guardian and
// Vault tabs and the example exchanges on the Ghost tab render this instead.

export interface Stat {
  readonly label: string
  readonly value: number
  readonly hit?: boolean
}

export interface GearItem {
  readonly name: string
  readonly rarity: Rarity
  readonly slot: string
  readonly power: number
}

export const guardian: {
  readonly subtitle: string
  readonly power: number
  readonly classes: readonly string[]
  readonly vault: { readonly used: number; readonly size: number }
  readonly weapons: readonly GearItem[]
  readonly armor: readonly GearItem[]
  readonly stats: readonly Stat[]
  readonly suggestion: { readonly text: string; readonly prompt: string }
} = {
  subtitle: "HUNTER · NIGHTSTALKER",
  power: 2007,
  classes: ["Hunter", "Warlock", "Titan"],
  vault: { used: 559, size: 600 },
  weapons: [
    { name: "Ace of Spades", rarity: "exotic", slot: "KINETIC", power: 2010 },
    { name: "Forbearance", rarity: "legendary", slot: "ENERGY · ARC", power: 2004 },
    { name: "Apex Predator", rarity: "legendary", slot: "POWER · SOLAR", power: 2001 },
  ],
  armor: [
    { name: "Mask of Bakris", rarity: "exotic", slot: "HELMET · EXOTIC", power: 2009 },
    { name: "Dreambane Grips", rarity: "legendary", slot: "ARMS", power: 2006 },
    { name: "Iron Forerunner", rarity: "legendary", slot: "CHEST", power: 2008 },
    { name: "Lustrous Strides", rarity: "legendary", slot: "LEGS", power: 2007 },
    { name: "Cloak of Five", rarity: "legendary", slot: "CLASS", power: 2005 },
  ],
  stats: [
    { label: "MOB", value: 100 },
    { label: "RES", value: 100 },
    { label: "REC", value: 40 },
    { label: "DIS", value: 30 },
    { label: "INT", value: 60 },
    { label: "STR", value: 20 },
  ],
  suggestion: {
    text: "Postmaster is at 9/21. Clear it before Trials?",
    prompt: "Empty the postmaster into the vault",
  },
}

export interface FlaggedItem {
  readonly id: string
  readonly name: string
  readonly rarity: Rarity
  readonly reason: "dupe" | "low"
  readonly why: string
  readonly perks: string
  readonly score: number
  readonly power: number
  readonly keep?: boolean
}

export const flagged: readonly FlaggedItem[] = [
  {
    id: "1",
    name: "Igneous Hammer",
    rarity: "legendary",
    reason: "dupe",
    why: "DUPLICATE · BETTER COPY (ROLL 94)",
    perks: "Encore · Kill Clip",
    score: 48,
    power: 1998,
  },
  {
    id: "2",
    name: "Cataphract GL3",
    rarity: "legendary",
    reason: "low",
    why: "LOW ROLL",
    perks: "Ambitious Assassin · Demolitionist",
    score: 31,
    power: 2008,
  },
  {
    id: "3",
    name: "Fatebringer (Timelost)",
    rarity: "legendary",
    reason: "dupe",
    why: "DUPLICATE",
    perks: "Explosive Payload · Firefly",
    score: 72,
    power: 2006,
    keep: true,
  },
  {
    id: "4",
    name: "Round Robin",
    rarity: "legendary",
    reason: "low",
    why: "LOW ROLL",
    perks: "Hip-Fire Grip · Adagio",
    score: 22,
    power: 1994,
  },
  {
    id: "5",
    name: "Taipan-4fr",
    rarity: "rare",
    reason: "dupe",
    why: "DUPLICATE · RARE",
    perks: "Triple Tap · Firing Line",
    score: 40,
    power: 1990,
  },
  {
    id: "6",
    name: "Dreambane Helm",
    rarity: "legendary",
    reason: "low",
    why: "LOW TOTAL · 57",
    perks: "Res 6 · Rec 10 · Dis 2",
    score: 29,
    power: 1996,
  },
]

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
