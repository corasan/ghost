// Pure helpers only: these files import contract types, never React Native.
import { describe, expect, test } from "bun:test"
import {
  ArmorMod,
  Briefing,
  BuildFacets,
  BuildReadiness,
  InGameSlot,
  InGameSlotRef,
  LoadoutIdentity,
  LoadoutSlots,
  SavedBuild,
  ChargeEffect,
  ItemSummary,
  LoadoutPlug,
  LoadoutSaveTo,
  Plan,
  SubclassChange,
  SubclassLoadout,
  SubclassSwap,
  PlanRow,
  PlanStat,
  OFF_BUILD_FIT,
  SetBonus,
  Source,
  StatMod,
  Synergy,
} from "@ghost/contract"

import { webUrl } from "./links"
import { briefingSentence, followUps, sinceLabel } from "./briefing"
import * as builds from "./build-filter"
import { slotChoice } from "./loadout-slots"
import { orderBuildStats } from "./build-order"
import { chargedMods } from "./charge"
import { firstParagraph, firstSentence } from "./effect-text"
import {
  appliedTotals,
  armorSet,
  bySlot,
  fragmentTotals,
  headline,
  statTicks,
  modPips,
  saveToLine,
  setBonusLine,
  slotLabel,
  splitRows,
  synergyParts,
  verdict,
} from "./plan-card"
import { defaultSelection } from "./selection"
import { placeTooltip } from "./tooltip"
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
  const stat = (label: string, value: number, target = false) =>
    new PlanStat({ label, value, target })

  test("asked-for stats lead, then the rest from highest to lowest", () => {
    const ordered = orderBuildStats([
      stat("HEALTH", 40),
      stat("MELEE", 80),
      stat("GRENADE", 27),
      stat("SUPER", 165),
      stat("CLASS", 17, true),
      stat("WEAPONS", 140),
    ])
    expect(ordered.map((each) => each.label)).toEqual([
      "CLASS",
      "SUPER",
      "WEAPONS",
      "MELEE",
      "HEALTH",
      "GRENADE",
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

  test("a stat fills one tick per twenty points and tops out at two hundred", () => {
    const filled = (value: number) => statTicks(value, 0).reduce((sum, tick) => sum + tick.base, 0)
    expect([10, 42, 165, 230].map(filled)).toEqual([0.5, 2.1, 8.25, 10])
  })

  test("the points fragments and mods add fill the ticks after the base", () => {
    expect(statTicks(110, 30).slice(3, 6)).toEqual([
      { base: 1, added: 0 },
      { base: 0, added: 1 },
      { base: 0, added: 0.5 },
    ])
    expect(statTicks(90, 30)[3]).toEqual({ base: 0, added: 1 })
    expect(statTicks(50, -10)[2]).toEqual({ base: 0.5, added: 0 })
  })

  test("fragment changes add up per stat, gains first, and cancel out", () => {
    const loadout = new SubclassLoadout({
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

  const armorMod = (name: string, mods: Array<[string, number]> = []) =>
    new ArmorMod({
      name,
      description: "",
      cost: 3,
      mods: mods.map(([label, delta]) => new StatMod({ label, delta })),
    })

  test("armor mods count toward what the footnote says was applied, alongside fragments", () => {
    const loadout = new SubclassLoadout({
      classType: "titan",
      subclass: "Sunbreaker",
      element: "solar",
      super: null,
      aspects: [],
      fragments: [fragment("Ember of Torches", [["HEALTH", -10]])],
    })
    const rows = [
      row("helm", { armorMods: [armorMod("Super Mod", [["SUPER", 10]]), armorMod("Firepower")] }),
      row("arms", { armorMods: [armorMod("Super Mod", [["SUPER", 10]])] }),
    ]
    expect(appliedTotals(plan({ loadout, rows })).map((mod) => [mod.label, mod.delta])).toEqual([
      ["SUPER", 20],
      ["HEALTH", -10],
    ])
  })

  test("mod swaps are counted in the verdict and drawn as their own pip", () => {
    const swap = new ArmorMod({ name: "Firepower", description: "", cost: 2, mods: [], swap: true })
    const helm = row("helm", { armorMods: [armorMod("Super Mod", [["SUPER", 10]]), swap] })
    const vaulted = row("arms", { action: "equip", origin: "VAULT", armorMods: [swap] })
    expect(modPips(helm)).toEqual(["stat", "swap"])
    expect(verdict(plan({ rows: [helm] }))).toEqual({
      plain: "Nothing moves.",
      change: "1 mod changes.",
    })
    expect(verdict(plan({ rows: [helm, vaulted] })).change).toBe("1 piece moves, 2 mods change.")
  })

  test("a piece shows a pip per socket: stat mods, other mods, then free slots", () => {
    const helm = row("helm", {
      armorMods: [armorMod("Firepower"), armorMod("Super Mod", [["SUPER", 10]])],
      freeModSlots: 2,
    })
    expect(modPips(helm)).toEqual(["other", "stat", "free", "free"])
    expect(modPips(row("old"))).toBeUndefined()
  })

  test("the class slot is named for the class that wears it", () => {
    expect(slotLabel("class", "titan")).toBe("Mark")
    expect(slotLabel("class", "hunter")).toBe("Cloak")
    expect(slotLabel("legs", "hunter")).toBe("Legs")
  })

  test("tiles run head to toe whatever order Ghost listed the pieces in", () => {
    const rows = [
      row("mark", { slot: "class" }),
      row("helm", { slot: "helmet" }),
      row("legs", { slot: "legs" }),
    ]
    expect(bySlot(rows).map((each) => each.name)).toEqual(["helm", "legs", "mark"])
  })

  test("a subclass change starts ticked and the verdict names the switch, or counts its plugs when the subclass stays", () => {
    const change = (replaces: string | null, swaps: number) =>
      new SubclassChange({
        itemInstanceId: "sentinel",
        itemHash: 1,
        characterId: "c1",
        replaces,
        previousItemId: replaces === null ? null : "behemoth",
        swaps: Array.from(
          { length: swaps },
          (_, i) =>
            new SubclassSwap({
              name: "Bastion",
              socketIndex: 5 + i,
              plugHash: 2,
              previousPlugHash: 3,
            }),
        ),
        selected: true,
        outcome: null,
        error: null,
      })
    const loadout = (replaces: string | null, swaps: number) =>
      new SubclassLoadout({
        classType: "titan",
        subclass: "Sentinel",
        element: "void",
        super: null,
        aspects: [],
        fragments: [],
        change: change(replaces, swaps),
      })
    const swap = new ArmorMod({ name: "Firepower", description: "", cost: 2, mods: [], swap: true })
    const helm = row("helm", { armorMods: [swap] })
    expect(verdict(plan({ loadout: loadout("Behemoth", 3), rows: [helm] }))).toEqual({
      plain: "Nothing moves.",
      change: "Switches to Sentinel, 1 mod changes.",
    })
    expect(verdict(plan({ loadout: loadout(null, 2) })).change).toBe("2 subclass plugs change.")
    expect([
      ...defaultSelection(plan({ loadout: loadout("Behemoth", 0), rows: [row("worn")] })),
    ]).toEqual(["sentinel"])
  })

  test("the verdict counts pieces that come from elsewhere before pieces that only get equipped", () => {
    const worn = row("worn")
    const carried = row("carried", { action: "equip" })
    const vaulted = row("vaulted", { action: "equip", origin: "VAULT" })
    expect(verdict(plan({ rows: [worn] }))).toEqual({ plain: "Nothing moves.", change: "" })
    expect(verdict(plan({ rows: [worn, carried] }))).toEqual({ plain: "1 to equip.", change: "" })
    expect(verdict(plan({ rows: [worn, carried, vaulted] }))).toEqual({
      plain: "",
      change: "1 piece moves.",
    })
  })

  describe("synergy", () => {
    const bonus = new SetBonus({
      name: "Overclocked",
      description: "",
      icon: null,
      set: "Techsec",
      required: 2,
      worn: 2,
    })
    const lastDiscipline = new SetBonus({
      name: "Steady Hands",
      description: "",
      icon: null,
      set: "Last Discipline",
      required: 4,
      worn: 3,
    })
    const exoticArms = row("Synthoceps", { tier: "exotic", slot: "arms" })
    const exoticWeapon = row("Gjallarhorn", { tier: "exotic", slot: "power" })
    const kinds = (built: Plan) => synergyParts(built).map((part) => part.kind)

    test("parts read exotic, set bonuses, mods, whatever Ghost wrote", () => {
      const parts = synergyParts(
        plan({
          rows: [row("helm", { slot: "helmet" }), exoticArms],
          setBonuses: [bonus],
          synergy: new Synergy({ mods: "m", setBonuses: "s", exotic: "e" }),
        }),
      )
      expect(parts).toEqual([
        { kind: "exotic", row: exoticArms, text: "e" },
        { kind: "setBonuses", on: [{ bonus, offBuild: false }], short: [], text: "s" },
        { kind: "mods", text: "m" },
      ])
    })

    test("an exotic weapon is not the build's exotic armor", () => {
      const built = plan({ rows: [exoticWeapon], synergy: new Synergy({ exotic: "e" }) })
      expect(kinds(built)).toEqual([])
    })

    test("weapons follow the exotic armor and carry the exotic weapon; the artifact comes last", () => {
      const parts = synergyParts(
        plan({
          rows: [exoticArms, row("Fatebringer", { slot: "kinetic" }), exoticWeapon],
          setBonuses: [bonus],
          synergy: new Synergy({ exotic: "e", weapons: "w", mods: "m", artifact: "a" }),
        }),
      )
      expect(parts.map((part) => part.kind)).toEqual([
        "exotic",
        "weapons",
        "setBonuses",
        "mods",
        "artifact",
      ])
      expect(parts[1]).toEqual({ kind: "weapons", exotic: exoticWeapon, text: "w" })
    })

    test("weapons and artifact show only when Ghost wrote about them", () => {
      expect(kinds(plan({ rows: [exoticWeapon] }))).toEqual([])
      expect(synergyParts(plan({ rows: [], synergy: new Synergy({ weapons: "w" }) }))).toEqual([
        { kind: "weapons", exotic: undefined, text: "w" },
      ])
    })

    test("active set bonuses show without Ghost's words, and nothing shows for an older plan", () => {
      expect(synergyParts(plan({ rows: [exoticArms], setBonuses: [bonus] }))).toEqual([
        { kind: "setBonuses", on: [{ bonus, offBuild: false }], short: [], text: undefined },
      ])
      expect(kinds(plan({ rows: [exoticArms] }))).toEqual([])
    })

    test("bonuses the build turns on come before the ones it is a piece short of", () => {
      expect(synergyParts(plan({ rows: [], setBonuses: [lastDiscipline, bonus] }))).toEqual([
        {
          kind: "setBonuses",
          on: [{ bonus, offBuild: false }],
          short: [lastDiscipline],
          text: undefined,
        },
      ])
    })

    test("a build only a piece short of a bonus still shows its set bonuses", () => {
      expect(synergyParts(plan({ rows: [], setBonuses: [lastDiscipline] }))).toEqual([
        { kind: "setBonuses", on: [], short: [lastDiscipline], text: undefined },
      ])
    })

    test("an active bonus Jev judged a poor fit is off-build; one a piece away never is", () => {
      const fitted = (fit: number, worn: number) => new SetBonus({ ...bonus, fit, worn })
      const part = synergyParts(
        plan({ rows: [], setBonuses: [fitted(0.1, 2), fitted(OFF_BUILD_FIT, 2), fitted(0.1, 1)] }),
      )[0]
      expect(part).toEqual({
        kind: "setBonuses",
        on: [
          { bonus: fitted(0.1, 2), offBuild: true },
          { bonus: fitted(OFF_BUILD_FIT, 2), offBuild: false },
        ],
        short: [fitted(0.1, 1)],
        text: undefined,
      })
    })

    test("the set line names the pieces needed, the set, and how far the build is from it", () => {
      expect(setBonusLine(bonus)).toBe("2-piece · Techsec")
      expect(setBonusLine(lastDiscipline)).toBe("4-piece · Last Discipline · 1 piece away")
    })
  })

  test("weapons sit apart from the armor, kinetic to power", () => {
    const rows = [
      row("rocket", { slot: "power" }),
      row("chest", { slot: "chest" }),
      row("bow", { slot: "kinetic" }),
      row("helm", { slot: "helmet" }),
      row("smg", { slot: "energy" }),
    ]
    const { pieces, weapons } = splitRows(rows)
    expect(pieces.map((each) => each.name)).toEqual(["helm", "chest"])
    expect(weapons.map((each) => each.name)).toEqual(["bow", "smg", "rocket"])
  })

  test("an in-game save names the slot as the game counts it and what it overwrites", () => {
    const saveTo = (patch: Partial<LoadoutSaveTo>) =>
      new LoadoutSaveTo({
        buildId: "b",
        characterId: "c1",
        index: 2,
        nameHash: 1,
        colorHash: 2,
        iconHash: 3,
        replaces: null,
        outcome: null,
        error: null,
        ...patch,
      })
    expect(saveToLine(saveTo({ replaces: "Raid" }))).toEqual({
      tone: "plan",
      text: "Saves to slot 3 in game, replacing Raid.",
    })
    expect(
      saveToLine(saveTo({ outcome: "skipped", error: "Gjallarhorn is not equipped" })),
    ).toEqual({ tone: "held", text: "Not saved to slot 3: Gjallarhorn is not equipped." })
  })
})

describe("effect text", () => {
  const harvest =
    "Picking up [Stasis] Stasis shards grants stacks of Frost Armor.\n\nWhile you have Frost Armor, defeating combatants may shatter them."

  test("glyph tokens are dropped and only the opening paragraph is kept", () => {
    expect(firstParagraph(harvest)).toBe("Picking up Stasis shards grants stacks of Frost Armor.")
    expect(firstParagraph("[Grenade]  : Hold to convert your grenade into a turret.")).toBe(
      "Hold to convert your grenade into a turret.",
    )
  })

  test("a long effect is cut to its first sentence", () => {
    expect(
      firstSentence("Summon a [Stasis] Stasis gauntlet. While your Super is active: slam."),
    ).toBe("Summon a Stasis gauntlet.")
  })
})

describe("chargedMods", () => {
  const mod = (name: string, patch: Partial<ArmorMod> = {}) =>
    new ArmorMod({ name, description: "", cost: 1, mods: [], ...patch })
  const effect = new ChargeEffect({
    effect: "+10% Arc weapon damage",
    source: new Source({ label: "test", url: null, asOf: null }),
  })

  test("groups charged mods by name, counts copies, and keeps the copy with numbers", () => {
    const grouped = chargedMods([
      mod("Arc Weapon Surge", { charged: true }),
      mod("Weapons Mod"),
      mod("Arc Weapon Surge", { charged: true, chargeEffect: effect }),
      mod("Melee Font", { charged: true }),
    ])
    expect(grouped.map((g) => [g.mod.name, g.copies, g.mod.chargeEffect?.effect])).toEqual([
      ["Arc Weapon Surge", 2, "+10% Arc weapon damage"],
      ["Melee Font", 1, undefined],
    ])
  })
})

describe("armor set", () => {
  const piece = (name: string, required: number, worn: number) =>
    new SetBonus({ name, description: "", icon: null, set: "Techsec", required, worn })

  test("names the set, counts worn pieces against the most any bonus needs, and turns on what they reach", () => {
    const four = piece("Overdrive", 4, 2)
    const two = piece("Overclocked", 2, 2)
    expect(armorSet([four, two])).toEqual({
      name: "Techsec",
      worn: 2,
      of: 4,
      bonuses: [
        { bonus: two, on: true },
        { bonus: four, on: false },
      ],
    })
  })

  test("a piece in no set has no armor set", () => {
    expect(armorSet(undefined)).toBeUndefined()
    expect(armorSet([])).toBeUndefined()
  })
})

describe("tooltip placement", () => {
  const host = { width: 400, height: 800 }
  const place = (anchor: { x: number; y: number }, height = 100) =>
    placeTooltip({
      anchor: { ...anchor, width: 24, height: 24 },
      host,
      height,
      maxWidth: 300,
      margin: 12,
      gap: 8,
      caretInset: 14,
    })

  test("sits below the anchor, centred on it, with the caret on the anchor", () => {
    expect(place({ x: 188, y: 100 })).toEqual({
      left: 50,
      top: 132,
      width: 300,
      caret: 150,
      side: "below",
    })
  })

  test("keeps inside the host near an edge, the caret on the anchor but clear of the corners", () => {
    expect(place({ x: 20, y: 100 })).toMatchObject({ left: 12, caret: 20 })
    expect(place({ x: 370, y: 100 })).toMatchObject({ left: 88, caret: 286 })
  })

  test("flips above the anchor when only above has room", () => {
    expect(place({ x: 188, y: 700 })).toMatchObject({ side: "above", top: 592 })
  })

  test("stays below when neither side has room", () => {
    expect(place({ x: 188, y: 60 }, 760)).toMatchObject({ side: "below", top: 92 })
  })
})

describe("in-game slot choice", () => {
  const identity = (hash: number, name: string) => new LoadoutIdentity({ hash, name, icon: null })
  const raid = identity(1, "Raid")
  const slots = new LoadoutSlots({
    slots: [
      new InGameSlot({
        index: 0,
        empty: false,
        name: raid,
        color: identity(20, "Red"),
        icon: identity(30, "Skull"),
        savedBuildId: null,
      }),
      new InGameSlot({
        index: 1,
        empty: true,
        name: null,
        color: null,
        icon: null,
        savedBuildId: null,
      }),
    ],
    names: [identity(2, "PvP"), raid],
    colors: [identity(21, "Blue"), identity(20, "Red")],
    icons: [identity(31, "Sword"), identity(30, "Skull")],
  })

  test("starts on the first empty slot with the first name, color and icon", () => {
    expect(slotChoice(slots, {}, undefined)).toEqual({
      index: 1,
      nameHash: 2,
      colorHash: 21,
      iconHash: 31,
    })
  })

  test("a build already in a slot starts there, and a filled slot keeps its look", () => {
    expect(slotChoice(slots, {}, 0)).toEqual({ index: 0, nameHash: 1, colorHash: 20, iconHash: 30 })
  })

  test("what the player picked wins", () => {
    expect(slotChoice(slots, { index: 0, colorHash: 21 }, undefined)).toEqual({
      index: 0,
      nameHash: 1,
      colorHash: 21,
      iconHash: 30,
    })
  })

  test("nothing to choose when the game lists no names", () => {
    expect(slotChoice(new LoadoutSlots({ ...slots, names: [] }), {}, undefined)).toBeUndefined()
  })
})

describe("build filter", () => {
  const ready = new BuildReadiness({ missing: [], pastArtifact: false, inGame: null })
  const saved = (
    id: string,
    facets: Partial<BuildFacets>,
    patch: Partial<SavedBuild> = {},
  ): SavedBuild =>
    new SavedBuild({
      id,
      name: id,
      plan: new Plan({
        kind: "build",
        title: "Build plan",
        subtitle: null,
        stats: [],
        featured: null,
        rows: [],
        note: null,
        confirmLabel: "EQUIP BUILD",
        status: "proposed",
      }),
      facets: new BuildFacets({
        classType: "hunter",
        element: "void",
        subclass: "Nightstalker",
        exoticArmor: null,
        exoticWeapon: null,
        weaponTypes: [],
        ...facets,
      }),
      readiness: ready,
      inGame: null,
      jobId: null,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T10:00:00Z",
      ...patch,
    })
  const slot = new InGameSlotRef({ characterId: "c1", index: 2, savedAt: "2026-10-02T10:00:00Z" })
  const gyrfalcon = saved(
    "Gyrfalcon",
    {
      exoticArmor: "Gyrfalcon's Hauberk",
      weaponTypes: ["Combat Bow", "Submachine Gun", "Rocket Launcher"],
    },
    { inGame: slot, createdAt: "2026-10-03T10:00:00Z" },
  )
  const hammer = saved(
    "Hammer",
    {
      classType: "titan",
      element: "solar",
      subclass: "Sunbreaker",
      exoticWeapon: "Gjallarhorn",
      weaponTypes: ["Rocket Launcher", "Rocket Launcher"],
    },
    {
      readiness: new BuildReadiness({ missing: ["Gjallarhorn"], pastArtifact: true, inGame: null }),
      createdAt: "2026-10-02T10:00:00Z",
    },
  )
  const unknown = saved("Unknown", { classType: "warlock", element: "arc" }, { readiness: null })
  const all = [hammer, unknown, gyrfalcon]
  const ids = (filter: Partial<builds.BuildFilter>) =>
    builds.filterBuilds(all, { ...builds.emptyBuildFilter, ...filter }).map((each) => each.id)

  test("newest first by default, and every search word must match somewhere", () => {
    expect(ids({})).toEqual(["Gyrfalcon", "Hammer", "Unknown"])
    expect(ids({ query: "rocket gjallarhorn" })).toEqual(["Hammer"])
    expect(ids({ query: "bow hauberk" })).toEqual(["Gyrfalcon"])
  })

  test("an exotic chip matches exotic armor and exotic weapons alike, and facets combine", () => {
    expect(ids({ exotics: new Set(["Gjallarhorn"]) })).toEqual(["Hammer"])
    expect(ids({ exotics: new Set(["Gjallarhorn", "Gyrfalcon's Hauberk"]) })).toEqual([
      "Gyrfalcon",
      "Hammer",
    ])
    expect(
      ids({ weaponTypes: new Set(["Rocket Launcher"]), classes: new Set(["titan"] as const) }),
    ).toEqual(["Hammer"])
  })

  test("in game and Ghost only split the list by whether a slot holds the build", () => {
    expect(ids({ where: "in_game" })).toEqual(["Gyrfalcon"])
    expect(ids({ where: "ghost_only" })).toEqual(["Hammer", "Unknown"])
  })

  test("a build Ghost could not check against Bungie is never called ready", () => {
    expect(ids({ state: "ready" })).toEqual(["Gyrfalcon"])
    expect(ids({ state: "missing_items" })).toEqual(["Hammer"])
    expect(ids({ state: "past_artifact" })).toEqual(["Hammer"])
  })

  test("sorting by class groups the classes before the names", () => {
    const zed = saved("A titan", { classType: "titan" })
    const sorted = builds.filterBuilds([...all, zed], { ...builds.emptyBuildFilter, sort: "class" })
    expect(sorted.map((each) => each.id)).toEqual(["Gyrfalcon", "A titan", "Hammer", "Unknown"])
  })

  test("chips list where, state and every chosen value; removing one keeps the rest", () => {
    const narrowed = {
      ...builds.emptyBuildFilter,
      where: "in_game" as const,
      state: "ready" as const,
      exotics: new Set(["Ex Diris: Reprise", "Gjallarhorn"]),
    }
    expect(builds.activeFilters(narrowed).map((each) => each.label)).toEqual([
      "IN GAME",
      "READY",
      "EX DIRIS: REPRISE",
      "GJALLARHORN",
    ])
    const next = builds.removeFilter(narrowed, "exotics:Ex Diris: Reprise")
    expect([...next.exotics]).toEqual(["Gjallarhorn"])
    expect(builds.removeFilter(next, "where").where).toBe("all")
    expect(builds.activeFilters(builds.emptyBuildFilter)).toEqual([])
  })

  test("facet chips come from the saved builds, counting each build once", () => {
    const options = builds.facetOptions(all)
    expect(options.classes).toEqual([
      { value: "hunter", count: 1 },
      { value: "titan", count: 1 },
      { value: "warlock", count: 1 },
    ])
    expect(options.elements.map((each) => each.value)).toEqual(["arc", "solar", "void"])
    expect(options.weaponTypes).toEqual([
      { value: "Rocket Launcher", count: 2 },
      { value: "Combat Bow", count: 1 },
      { value: "Submachine Gun", count: 1 },
    ])
    expect(options.exotics.map((each) => each.value)).toEqual([
      "Gjallarhorn",
      "Gyrfalcon's Hauberk",
    ])
  })
})
