import { describe, expect, test } from "bun:test"
import { type ItemSlot, SetBonus } from "@ghost/contract"
import { Effect, Layer } from "effect"
import { Jev, JevUnavailable } from "../agent/jev.ts"
import type { Inventory, OwnedItem, SubclassPart } from "../bungie/inventory.ts"
import type { ArmorModEntry, PlugFacts } from "../bungie/manifest.ts"
import {
  findArmorMods,
  findItems,
  findSubclassDetail,
  rankingText,
  searchItems,
  subclassDetail,
  type SubclassView,
  synergyMissing,
  topPerSlot,
} from "./tools.ts"

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 1,
  name: `Item ${id}`,
  typeName: "Helmet",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "none",
  power: 550,
  quantity: 1,
  location: "vault",
  characterId: null,
  equipped: false,
  classType: "titan",
  locked: false,
  masterwork: false,
  statTotal: 60,
  perks: [],
  duplicates: 0,
  decision: null,
  acquiredAt: null,
  armorStats: {
    mobility: 0,
    resilience: 30,
    recovery: 0,
    discipline: 20,
    intellect: 10,
    strength: 0,
  },
  plugHashes: [],
  modSockets: [],
  energy: null,
  exoticPerk: null,
  set: null,
  ...fields,
})

const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map((r) => r.id)

describe("topPerSlot", () => {
  const helmets = Array.from({ length: 8 }, (_, i) => owned(`h${i}`, "helmet"))
  const chest = owned("c0", "chest")
  const legs = owned("l0", "legs")
  const relevance = new Map([
    ...helmets.map((h, i) => [h.itemInstanceId, 0.9 - i * 0.01] as const),
    ["c0", 0.2],
    ["l0", 0.456],
  ])

  test("a slot full of strong items cannot starve the other slots", () => {
    const rows = topPerSlot([...helmets, chest, legs], relevance, 3)
    expect(ids(rows).toSorted()).toEqual(["c0", "h0", "h1", "h2", "l0"])
  })

  test("keeps the most relevant items of a slot and orders rows by relevance", () => {
    const rows = topPerSlot([legs, ...helmets.toReversed(), chest], relevance, 2)
    expect(rows.map((r) => [r.id, r.relevance])).toEqual([
      ["h0", 0.9],
      ["h1", 0.89],
      ["l0", 0.46],
      ["c0", 0.2],
    ])
  })
})

describe("rankingText", () => {
  test("describes an armor piece on one line with its stats highest first", () => {
    expect(
      rankingText(owned("h0", "helmet", { masterwork: true, perks: ["Spirit of Synthoceps"] })),
    ).toBe(
      "Item h0; legendary titan Helmet; helmet slot; masterworked; stats, highest first: Health 30, Grenade 20, Super 10 (total 60); perks: Spirit of Synthoceps",
    )
  })

  test("names an exotic's intrinsic perk so its element is visible", () => {
    expect(
      rankingText(
        owned("e0", "legs", {
          tier: "exotic",
          exoticPerk: "Phoenix Rising: Sunspots heal allies.",
        }),
      ),
    ).toContain("exotic perk: Phoenix Rising: Sunspots heal allies.")
  })

  test("names the armor set a piece belongs to", () => {
    expect(rankingText(owned("s0", "arms", { set: "AION Renewal" }))).toContain(
      "armor set: AION Renewal",
    )
  })
})

const failing = Layer.succeed(Jev, {
  rank: () => Effect.fail(new JevUnavailable({ message: "TYPESAFE_API_KEY is not set" })),
})

const scoring = Layer.succeed(Jev, {
  rank: (_, candidates) =>
    Effect.succeed(new Map(candidates.map((c, i) => [c.id, (i + 1) / candidates.length]))),
})

describe("findItems", () => {
  const inventory: Inventory = {
    membershipType: 3,
    membershipId: "1",
    characters: [],
    items: [
      owned("h0", "helmet"),
      owned("h1", "helmet"),
      owned("h2", "helmet"),
      owned("c0", "chest"),
    ],
    vaultCount: 4,
  }

  const run = (filters: Parameters<typeof findItems>[1], jev: Layer.Layer<Jev>) =>
    Effect.runSync(findItems(inventory, filters).pipe(Effect.provide(jev)))

  test("falls back to the unranked search and says so when Jev is unavailable", () => {
    const filters = { purpose: "Void Titan build prioritizing Health", limit: 2 }
    expect(run(filters, failing)).toEqual({
      ...searchItems(inventory, filters),
      ranking: "unavailable",
    })
  })

  test("returns today's unranked search without a purpose, never asking Jev", () => {
    expect(run({ limit: 2 }, failing)).toEqual(searchItems(inventory, { limit: 2 }))
  })

  test("with a purpose, returns the top items per slot by Jev's relevance", () => {
    const result = run({ purpose: "Void Titan build prioritizing Health", limit: 2 }, scoring)
    expect(result.total).toBe(4)
    expect(ids(result.items)).toEqual(["c0", "h2", "h1"])
  })
})

const facts = (fields: Partial<PlugFacts> = {}): PlugFacts => ({
  mods: {},
  classMods: {},
  fragmentSlots: 0,
  energyCost: 1,
  category: "enhancements.v2_general",
  artifact: false,
  charged: false,
  description: "",
  ...fields,
})

const mod = (hash: number, name: string, fields: Partial<PlugFacts> = {}): ArmorModEntry => ({
  hash,
  name,
  icon: null,
  ...facts({ description: `${name} effect`, ...fields }),
})

describe("findArmorMods", () => {
  const catalog = [
    mod(1, "Health Mod", { mods: { "392767087": 10 }, energyCost: 3 }),
    ...Array.from({ length: 6 }, (_, i) => mod(10 + i, `Utility ${i}`)),
    mod(2, "Minor Class Mod", { mods: { "1943323491": 5 } }),
  ]

  const run = (filters: Parameters<typeof findArmorMods>[1], jev: Layer.Layer<Jev>) =>
    Effect.runSync(findArmorMods(catalog, filters).pipe(Effect.provide(jev)))

  const names = (found: ReturnType<typeof run>) => found.mods.map(({ entry }) => entry.name)

  test("keeps every stat mod and cuts the rest to the most relevant few", () => {
    const found = run({ purpose: "Void Titan, 100 Health", limit: 2 }, scoring)
    expect(found.total).toBe(8)
    expect(names(found)).toEqual(["Health Mod", "Minor Class Mod", "Utility 5", "Utility 4"])
    expect(found.mods.map(({ relevance }) => relevance)).toEqual([undefined, undefined, 1, 0.83])
  })

  test("filters by text before ranking", () => {
    const found = run({ purpose: "Void Titan", text: "health" }, scoring)
    expect(names(found)).toEqual(["Health Mod"])
  })

  test("falls back to the unranked list and says so when Jev is unavailable", () => {
    expect(run({ purpose: "Void Titan", limit: 2 }, failing)).toEqual({
      ...run({}, failing),
      ranking: "unavailable",
    })
    expect(run({}, failing).mods).toHaveLength(8)
  })
})

describe("subclass detail", () => {
  const plug = (hash: number, name: string) => ({
    hash,
    name,
    description: `${name} effect`,
    icon: null,
  })
  const aspects = Array.from({ length: 6 }, (_, i) => plug(100 + i, `Aspect ${i}`))
  const fragments = Array.from({ length: 12 }, (_, i) => plug(200 + i, `Fragment ${i}`))
  const grenades = Array.from({ length: 4 }, (_, i) => plug(300 + i, `Grenade ${i}`))
  const socket = (
    index: number,
    part: SubclassPart,
    current: number,
    options: ReadonlyArray<ReturnType<typeof plug>>,
  ) => ({ index, part, current, enabled: true, options })
  const view: SubclassView = {
    subclass: { name: "Sentinel", element: "void", equipped: false },
    defs: new Map(),
    sockets: [
      socket(0, "grenade", 303, grenades),
      socket(1, "aspect", 100, aspects),
      socket(2, "aspect", 105, aspects),
      socket(3, "fragment", 200, fragments),
    ],
    plugs: new Map(aspects.map((a) => [a.hash, facts({ fragmentSlots: 2 })])),
  }
  const relevance = new Map([
    ...aspects.map((a, i) => [`aspect:${a.hash}`, 0.5 + i / 10] as const),
    ...fragments.map((f, i) => [`fragment:${f.hash}`, 0.2 + i / 20] as const),
    ...grenades.map((g, i) => [`grenade:${g.hash}`, 0.9 - i / 10] as const),
  ])

  const effects = (
    rows: ReadonlyArray<{ readonly name: string; readonly effect?: string | null | undefined }>,
  ) => rows.flatMap((row) => (row.effect !== undefined ? row.name : []))

  test("lists every option but keeps effect text only for the top aspects and fragments and what is slotted", () => {
    const detail = subclassDetail(view, "titan", relevance)
    expect(detail.aspects.map((a) => a.name)).toEqual(aspects.map((a) => a.name).toReversed())
    expect(effects(detail.aspects)).toEqual(["Aspect 5", "Aspect 4", "Aspect 3", "Aspect 0"])
    expect(detail.fragments).toHaveLength(12)
    expect(effects(detail.fragments)).toEqual([
      "Fragment 11",
      "Fragment 10",
      "Fragment 9",
      "Fragment 8",
      "Fragment 7",
      "Fragment 6",
      "Fragment 5",
      "Fragment 4",
      "Fragment 0",
    ])
    expect(detail.grenade?.options).toEqual(
      grenades.map((g, i) => ({ name: g.name, relevance: Math.round((0.9 - i / 10) * 100) / 100 })),
    )
  })

  test("falls back to the unranked detail and says so when Jev is unavailable", () => {
    const run = (purpose: string | undefined) =>
      Effect.runSync(findSubclassDetail(view, "titan", purpose).pipe(Effect.provide(failing)))
    expect(run("Void Titan overshields")).toEqual({
      ...subclassDetail(view, "titan"),
      ranking: "unavailable",
    })
    expect(run(undefined)).toEqual(subclassDetail(view, "titan"))
  })
})

describe("synergyMissing", () => {
  const forceConverter = new SetBonus({
    name: "Force Converter",
    description: "After a final blow with a Rocket Launcher, sprint to gain Speed Booster.",
    icon: null,
    set: "AION Renewal",
    required: 2,
    worn: 2,
  })
  const exotic = owned("x0", "chest", {
    name: "Starfire Protocol",
    tier: "exotic",
    exoticPerk: "Fusion Overdrive: an extra grenade charge.",
  })
  const full = { exotic, setBonuses: [forceConverter], modded: true }

  test("asks for every part the build has and lacks synergy for", () => {
    const parts = synergyMissing({ ...full, synergy: { exotic: " " } })
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain("Starfire Protocol (Fusion Overdrive: an extra grenade charge.)")
    expect(parts[1]).toContain(
      "Force Converter (AION Renewal, 2 pieces, wearing 2): After a final blow",
    )
    expect(parts[2]).toStartWith("mods")
  })

  test("accepts a build once each of its parts has synergy", () => {
    expect(
      synergyMissing({
        ...full,
        synergy: { exotic: "Grenades.", setBonuses: "Speed.", mods: "Energy." },
      }),
    ).toEqual([])
  })

  test("asks for setBonuses synergy only about the bonuses the build turns on", () => {
    const aionFour = new SetBonus({ ...forceConverter, name: "AION Four", required: 4, worn: 3 })
    expect(
      synergyMissing({
        exotic: undefined,
        setBonuses: [aionFour],
        modded: false,
        synergy: undefined,
      }),
    ).toEqual([])
    const [part] = synergyMissing({
      exotic: undefined,
      setBonuses: [forceConverter, aionFour],
      modded: false,
      synergy: undefined,
    })
    expect(part).toContain("Force Converter")
    expect(part).not.toContain("AION Four")
  })

  test("asks for no part the build lacks", () => {
    expect(
      synergyMissing({ exotic: undefined, setBonuses: [], modded: false, synergy: undefined }),
    ).toEqual([])
  })
})
