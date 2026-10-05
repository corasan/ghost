// Pure helpers only: these files import contract types, never React Native.
import { describe, expect, test } from "bun:test"
import {
  Briefing,
  ItemSummary,
  LoadoutPlug,
  Plan,
  PlanLoadout,
  PlanRow,
  PlanStat,
  StatMod,
} from "@ghost/contract"

import { webUrl } from "./links"
import { briefingSentence, followUps, sinceLabel } from "./briefing"
import { orderBuildStats } from "./build-order"
import { bySlot, fragmentTotals, headline, litTicks, slotLabel, verdict } from "./plan-card"
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

describe("webUrl", () => {
  test("passes web addresses through", () => {
    expect(webUrl("https://destiny2.science/endgame?tab=3")).toBe(
      "https://destiny2.science/endgame?tab=3",
    )
    expect(webUrl(" http://example.com ")).toBe("http://example.com/")
  })

  test("refuses anything that is not a web address", () => {
    for (const link of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ghost://settings",
      "tel:5551234",
      "data:text/html,<script>1</script>",
      "not a link",
      "",
    ]) {
      expect(webUrl(link)).toBeNull()
    }
  })

  test("is not fooled by a scheme hidden behind case or whitespace", () => {
    expect(webUrl("JaVaScRiPt:alert(1)")).toBeNull()
    expect(webUrl("  javascript:alert(1)")).toBeNull()
  })
})

describe("build card", () => {
  const row = (id: string, patch: Partial<PlanRow> = {}) =>
    new PlanRow({
      itemInstanceId: id,
      itemHash: 1,
      name: id,
      icon: null,
      tier: "legendary",
      meta: "",
      power: 530,
      score: null,
      action: "none",
      characterId: "c1",
      selected: false,
      outcome: null,
      error: null,
      ...patch,
    })
  const plan = (patch: Partial<Plan> = {}) =>
    new Plan({
      kind: "build",
      title: "Build plan",
      subtitle: "Sunbreaker",
      stats: [],
      featured: null,
      rows: [],
      note: null,
      confirmLabel: "EQUIP BUILD",
      status: "proposed",
      ...patch,
    })
  const fragment = (name: string, mods: Array<[string, number]>) =>
    new LoadoutPlug({
      name,
      description: "",
      mods: mods.map(([label, delta]) => new StatMod({ label, delta })),
    })

  test("the headline is the stats the player asked for, else what Ghost called the build", () => {
    const stats = [
      new PlanStat({ label: "SUPER", value: 165, target: true }),
      new PlanStat({ label: "MELEE", value: 95, target: false }),
      new PlanStat({ label: "WEAPONS", value: 150, target: true }),
    ]
    expect(headline(plan({ stats }))).toBe("SUPER + WEAPONS")
    expect(headline(plan())).toBe("SUNBREAKER")
  })

  test("a stat lights one tick per twenty points and tops out at two hundred", () => {
    expect([17, 42, 165, 230].map(litTicks)).toEqual([0, 2, 8, 10])
  })

  test("fragment changes add up per stat, gains first, and cancel out", () => {
    const loadout = new PlanLoadout({
      classType: "titan",
      subclass: "Sunbreaker",
      element: "solar",
      super: null,
      aspects: [],
      fragments: [
        fragment("Ember of Torches", [["HEALTH", -10]]),
        fragment("Ember of Searing", [["WEAPONS", 10]]),
        fragment("Ember of Char", [["CLASS", 10]]),
        fragment("Ember of Ashes", [["CLASS", -10]]),
      ],
    })
    expect(fragmentTotals(loadout).map((mod) => [mod.label, mod.delta])).toEqual([
      ["WEAPONS", 10],
      ["HEALTH", -10],
    ])
  })

  test("the class slot is named for the class that wears it", () => {
    expect(slotLabel("class", "titan")).toBe("MARK")
    expect(slotLabel("class", "hunter")).toBe("CLOAK")
    expect(slotLabel("legs", "hunter")).toBe("LEGS")
  })

  test("tiles run head to toe whatever order Ghost listed the pieces in", () => {
    const rows = [
      row("mark", { slot: "class" }),
      row("helm", { slot: "helmet" }),
      row("legs", { slot: "legs" }),
    ]
    expect(bySlot(rows).map((each) => each.name)).toEqual(["helm", "legs", "mark"])
  })

  test("the verdict counts pieces that come from elsewhere before pieces that only get equipped", () => {
    const worn = row("worn")
    const carried = row("carried", { action: "equip" })
    const vaulted = row("vaulted", { action: "equip", origin: "VAULT" })
    expect(verdict(plan({ rows: [worn] }))).toEqual({ text: "Nothing moves.", moves: false })
    expect(verdict(plan({ rows: [worn, carried] }))).toEqual({ text: "1 to equip.", moves: false })
    expect(verdict(plan({ rows: [worn, carried, vaulted] }))).toEqual({
      text: "1 piece moves.",
      moves: true,
    })
  })
})
