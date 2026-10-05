// Pure helpers only: these files import contract types, never React Native.
import { describe, expect, test } from "bun:test"
import { Briefing, ItemSummary, PlanStat } from "@ghost/contract"

import { briefingSentence, followUps, sinceLabel } from "./briefing"
import { orderBuildStats } from "./build-order"
import {
  activeFilters,
  emptyFilter,
  filterVault,
  flagCounts,
  removeFilter,
  toggle,
} from "./vault-filter"

const briefing = (patch: Partial<Briefing> = {}) =>
  new Briefing({
    since: "2026-10-03T22:00:00",
    newCount: 11,
    upgrades: [],
    postmasterCount: 9,
    postmasterCapacity: 21,
    vaultCount: 400,
    vaultCapacity: 700,
    recentCount: 11,
    undecidedCount: 6,
    actionsToday: 0,
    ...patch,
  })

const item = (patch: Partial<ItemSummary>) =>
  new ItemSummary({
    itemInstanceId: "1",
    itemHash: 1,
    name: "Igneous Hammer",
    typeName: "Hand Cannon",
    icon: null,
    tier: "legendary",
    slot: "kinetic",
    damageType: "solar",
    power: 2000,
    quantity: 1,
    location: "vault",
    characterId: null,
    equipped: false,
    classType: null,
    locked: false,
    masterwork: false,
    statTotal: null,
    perks: ["Rangefinder", "Eye of the Storm"],
    duplicates: 0,
    decision: null,
    acquiredAt: null,
    ...patch,
  })

describe("since label", () => {
  const now = new Date("2026-10-04T21:00:00")
  test("evening yesterday reads as last night", () => {
    expect(sinceLabel("2026-10-03T22:00:00", now)).toBe("Since last night")
  })
  test("earlier today", () => {
    expect(sinceLabel("2026-10-04T09:00:00", now)).toBe("Since this morning")
  })
  test("within the week names the day", () => {
    expect(sinceLabel("2026-09-30T12:00:00", now)).toBe("Since Wednesday")
  })
})

describe("briefing sentence", () => {
  const now = new Date("2026-10-04T21:00:00")
  test("matches the design's opening line", () => {
    const upgrade = item({})
    expect(briefingSentence(briefing({ upgrades: [upgrade, upgrade] }), now)).toBe(
      "Since last night: 11 new items, two of them beat what you have on. Postmaster is at 9 of 21.",
    )
  })
  test("first run explains tracking instead of counting", () => {
    expect(briefingSentence(briefing({ since: null, postmasterCount: 0 }), now)).toStartWith(
      "First sync done.",
    )
  })
  test("follow-ups lead with upgrades, then the postmaster", () => {
    const steps = followUps(briefing({ upgrades: [item({})] }))
    expect(steps.map((step) => step.label)).toEqual(["SHOW UPGRADES", "CLEAR POSTMASTER"])
  })
})

describe("vault filter", () => {
  const items = [
    item({ itemInstanceId: "a", name: "Igneous Hammer", power: 2010, duplicates: 1 }),
    item({ itemInstanceId: "b", name: "Igneous Hammer", power: 1990, duplicates: 1 }),
    item({
      itemInstanceId: "c",
      name: "Gyrfalcon's Hauberk",
      typeName: "Chest Armor",
      slot: "chest",
      tier: "exotic",
      damageType: "none",
      classType: "hunter",
      statTotal: 68,
      perks: [],
      power: 2004,
      decision: "junk",
    }),
  ]
  test("searches perks as well as names, every word must match", () => {
    expect(
      filterVault(items, { ...emptyFilter, query: "eye storm" }).map((i) => i.itemInstanceId),
    ).toEqual(["a", "b"])
  })
  test("facets combine: armor for hunters only", () => {
    const filter = {
      ...emptyFilter,
      category: "armor" as const,
      classes: toggle(emptyFilter.classes, "hunter" as const),
    }
    expect(filterVault(items, filter).map((i) => i.itemInstanceId)).toEqual(["c"])
  })
  test("dupes flag and counts agree", () => {
    const filter = { ...emptyFilter, flags: toggle(emptyFilter.flags, "dupes" as const) }
    expect(filterVault(items, filter)).toHaveLength(2)
    expect(flagCounts(items, "all").dupes).toBe(2)
    expect(flagCounts(items, "all").junk).toBe(1)
  })
  test("sorts by power by default", () => {
    expect(filterVault(items, emptyFilter).map((i) => i.power)).toEqual([2010, 2004, 1990])
  })
})

describe("active vault filters", () => {
  const narrowed = {
    ...emptyFilter,
    category: "armor" as const,
    tiers: new Set(["exotic", "legendary"] as const),
    classes: new Set(["titan"] as const),
    flags: new Set(["dupes"] as const),
  }

  test("an untouched filter has nothing to show, whatever the sort or search", () => {
    expect(activeFilters({ ...emptyFilter, sort: "name", query: "hammer" })).toEqual([])
  })

  test("lists the category and every chosen value, naming class filters as armor", () => {
    expect(activeFilters(narrowed).map((each) => each.label)).toEqual([
      "ARMOR",
      "EXOTIC",
      "LEGENDARY",
      "TITAN ARMOR",
      "DUPES",
    ])
  })

  test("removing a chip drops only that value", () => {
    const next = removeFilter(narrowed, "tiers:exotic")
    expect([...next.tiers]).toEqual(["legendary"])
    expect(activeFilters(next).map((each) => each.label)).toEqual([
      "ARMOR",
      "LEGENDARY",
      "TITAN ARMOR",
      "DUPES",
    ])
  })

  test("removing the category chip goes back to everything", () => {
    expect(removeFilter(narrowed, "category").category).toBe("all")
  })

  test("removing every chip one by one ends at no active filters", () => {
    const cleared = activeFilters(narrowed).reduce(
      (filter, each) => removeFilter(filter, each.id),
      narrowed,
    )
    expect(activeFilters(cleared)).toEqual([])
  })
})

describe("orderBuildStats", () => {
  const stat = (label: string, before: number, value: number, target = false) =>
    new PlanStat({ label, value, target, before })

  test("asked-for stats lead, then gains by size, then losses, then unchanged", () => {
    const ordered = orderBuildStats([
      stat("HEALTH", 40, 40),
      stat("MELEE", 95, 80),
      stat("GRENADE", 17, 27),
      stat("SUPER", 122, 165),
      stat("CLASS", 17, 17, true),
      stat("WEAPONS", 130, 140),
    ])
    expect(ordered.map((each) => each.label)).toEqual([
      "CLASS",
      "SUPER",
      "GRENADE",
      "WEAPONS",
      "MELEE",
      "HEALTH",
    ])
  })
})
