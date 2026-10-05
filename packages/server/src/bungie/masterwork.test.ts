import { describe, expect, test } from "bun:test"
import { PlanStat } from "@ghost/contract"
import { type ArmorStats, STAT } from "./inventory.ts"
import { statModsFrom } from "./manifest.ts"
import {
  armorStats,
  buildStats,
  masterworked,
  missedTargets,
  withMasterworkTotals,
} from "./masterwork.ts"

const stats = (patch: Partial<ArmorStats>): ArmorStats =>
  ({
    mobility: 0,
    resilience: 0,
    recovery: 0,
    discipline: 0,
    intellect: 0,
    strength: 0,
    ...patch,
  }) as ArmorStats

const fresh = stats({ discipline: 30, intellect: 25, strength: 20 })

describe("masterworked", () => {
  test("raises the three stats a piece did not roll to five and leaves the rolled ones", () => {
    expect(masterworked(fresh)).toEqual({
      mobility: 5,
      resilience: 5,
      recovery: 5,
      discipline: 30,
      intellect: 25,
      strength: 20,
    })
  })

  test("a partly upgraded piece still ends at five, not five more", () => {
    const partly = stats({
      mobility: 2,
      resilience: 2,
      recovery: 2,
      discipline: 30,
      intellect: 25,
      strength: 20,
    })
    expect(masterworked(partly)).toMatchObject({ mobility: 5, resilience: 5, recovery: 5 })
  })

  test("a rolled stat as low as five is not mistaken for an unrolled one", () => {
    const lowRoll = stats({ discipline: 30, intellect: 25, strength: 5 })
    expect(masterworked(lowRoll)).toMatchObject({ strength: 5, discipline: 30, intellect: 25 })
    expect(Object.values(masterworked(lowRoll) ?? {}).reduce((a, b) => a + b, 0)).toBe(75)
  })

  test("older armor that rolled all six stats has no preview", () => {
    expect(
      masterworked(
        stats({
          mobility: 17,
          resilience: 9,
          recovery: 11,
          discipline: 8,
          intellect: 40,
          strength: 4,
        }),
      ),
    ).toBeNull()
  })
})

describe("armorStats", () => {
  const shown = (item: Parameters<typeof armorStats>[0]) =>
    armorStats(item).map((stat) => [stat.label, stat.value, stat.masterworked])

  test("a weapon has none", () => {
    expect(armorStats({ armorStats: null, masterwork: false })).toEqual([])
  })

  test("an unmasterworked piece shows the masterworked value only where it changes", () => {
    expect(shown({ armorStats: fresh, masterwork: false })).toEqual([
      ["HEALTH", 0, 5],
      ["MELEE", 20, undefined],
      ["GRENADE", 30, undefined],
      ["SUPER", 25, undefined],
      ["CLASS", 0, 5],
      ["WEAPONS", 0, 5],
    ])
  })

  test("a masterworked piece shows its stats with nothing to gain", () => {
    const done = stats({
      mobility: 5,
      resilience: 5,
      recovery: 5,
      discipline: 30,
      intellect: 25,
      strength: 20,
    })
    expect(
      shown({ armorStats: done, masterwork: true }).every(([, , gain]) => gain === undefined),
    ).toBe(true)
  })
})

describe("withMasterworkTotals", () => {
  const total = (label: string, value: number) => new PlanStat({ label, value, target: true })
  const pieces = [
    { armorStats: fresh, masterwork: false },
    { armorStats: stats({ mobility: 30, intellect: 30, strength: 25 }), masterwork: false },
    {
      armorStats: stats({
        mobility: 5,
        resilience: 30,
        recovery: 5,
        discipline: 5,
        intellect: 30,
        strength: 25,
      }),
      masterwork: true,
    },
  ]
  const after = (label: string, value: number) =>
    withMasterworkTotals([total(label, value)], pieces)[0]?.masterworked

  test("adds what every unmasterworked piece would gain in that stat", () => {
    expect(after("Health", 30)).toBe(40)
    expect(after("Weapons", 35)).toBe(40)
  })

  test("matches the stat whatever the agent's casing, and by its older name", () => {
    expect(after("CLASS", 5)).toBe(15)
    expect(after("recovery", 5)).toBe(15)
  })

  test("a stat no listed piece would gain in is left as it is", () => {
    expect(after("Super", 85)).toBeUndefined()
  })

  test("a total that is not one of the six stats is left as it is", () => {
    expect(after("Power", 540)).toBeUndefined()
  })
})

describe("buildStats", () => {
  const piece = (
    itemInstanceId: string,
    slot: "helmet" | "arms" | "chest" | "legs" | "class",
    armorStats: ArmorStats,
    masterwork = true,
  ) => ({ itemInstanceId, slot, armorStats, masterwork })

  const character = {
    stats: stats({
      mobility: 140,
      resilience: 42,
      recovery: 17,
      discipline: 17,
      intellect: 165,
      strength: 95,
    }),
  }
  const helm = piece(
    "helm",
    "helmet",
    stats({ resilience: 20, intellect: 25, mobility: 30 }),
    false,
  )
  const arms = piece(
    "arms",
    "arms",
    stats({ mobility: 30, intellect: 30, strength: 25, resilience: 5, recovery: 5, discipline: 5 }),
  )
  const worn = [helm, arms]
  const facts = {
    "144602215": {
      name: "Super",
      effect: "Increases the amount of Super energy from all sources.",
    },
  }

  const byLabel = (result: ReturnType<typeof buildStats>) =>
    Object.fromEntries(result.map((stat) => [stat.label, stat]))

  test("with nothing to equip the build is what the character already has", () => {
    const result = byLabel(buildStats({ character, worn, incoming: [], targets: [], facts: {} }))
    expect(result.SUPER?.value).toBe(165)
    expect(result.WEAPONS?.value).toBe(140)
  })

  test("swapping a piece removes the old piece's stats and adds the new one's", () => {
    const newHelm = piece("new", "helmet", stats({ discipline: 30, intellect: 30, mobility: 15 }))
    const result = byLabel(
      buildStats({ character, worn, incoming: [newHelm], targets: [], facts: {} }),
    )
    expect(result.SUPER?.value).toBe(170)
    expect(result.WEAPONS?.value).toBe(125)
    expect(result.HEALTH?.value).toBe(22)
    expect(result.GRENADE?.value).toBe(47)
    expect(result.MELEE?.value).toBe(95)
  })

  test("a piece already worn is not counted twice when the plan equips it", () => {
    const result = byLabel(
      buildStats({ character, worn, incoming: [arms], targets: [], facts: {} }),
    )
    expect(result.WEAPONS?.value).toBe(140)
  })

  test("masterwork values cover every piece worn after the build, not just the new ones", () => {
    const result = byLabel(buildStats({ character, worn, incoming: [], targets: [], facts: {} }))
    expect(result.MELEE?.masterworked).toBe(100)
    expect(result.CLASS?.masterworked).toBe(22)
    expect(result.SUPER?.masterworked).toBeUndefined()
  })

  test("a weapon in the plan changes no stat", () => {
    const gun = {
      itemInstanceId: "gun",
      slot: "kinetic" as const,
      armorStats: null,
      masterwork: false,
    }
    const result = byLabel(buildStats({ character, worn, incoming: [gun], targets: [], facts: {} }))
    expect(result.SUPER?.value).toBe(165)
  })

  test("marks the stats the player asked for and carries Bungie's name and effect text", () => {
    const result = byLabel(
      buildStats({ character, worn, incoming: [], targets: ["super", "Weapons"], facts }),
    )
    expect(result.SUPER?.target).toBe(true)
    expect(result.WEAPONS?.target).toBe(true)
    expect(result.HEALTH?.target).toBe(false)
    expect(result.SUPER?.effect).toBe("Increases the amount of Super energy from all sources.")
    expect(result.HEALTH?.effect).toBeUndefined()
  })
})

describe("statModsFrom", () => {
  const definition = {
    investmentStats: [
      { statTypeHash: Number(STAT.mobility), value: 10 },
      { statTypeHash: Number(STAT.strength), value: 0 },
      { statTypeHash: Number(STAT.recovery), value: -10, isConditionallyActive: true },
      { statTypeHash: 123, value: 5 },
    ],
  }

  test("keeps the armor stats a plug moves and sets the class-conditional ones apart", () => {
    expect(statModsFrom(definition, false)).toEqual({ [STAT.mobility]: 10 })
    expect(statModsFrom(definition, true)).toEqual({ [STAT.recovery]: -10 })
  })
})

describe("missedTargets", () => {
  const totals = [
    new PlanStat({ label: "HEALTH", value: 104, target: true }),
    new PlanStat({ label: "CLASS", value: 92, target: true }),
    new PlanStat({ label: "WEAPONS", value: 30, target: false }),
  ]

  test("names each asked-for stat the build leaves short, with the number asked and the total", () => {
    expect(
      missedTargets(totals, [
        { label: "Health", value: 100 },
        { label: "Class", value: 100 },
      ]),
    ).toEqual([{ label: "CLASS", requested: 100, value: 92 }])
  })

  test("passes a build whose totals reach every number asked", () => {
    expect(
      missedTargets(totals, [
        { label: "health", value: 104 },
        { label: "Class", value: 92 },
      ]),
    ).toEqual([])
  })

  test("matches a stat by its armor name as buildStats does", () => {
    expect(missedTargets(totals, [{ label: " recovery ", value: 100 }])).toEqual([
      { label: "CLASS", requested: 100, value: 92 },
    ])
  })
})
