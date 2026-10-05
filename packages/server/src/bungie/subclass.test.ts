import { describe, expect, test } from "bun:test"
import { STAT } from "./inventory.ts"
import { loadoutStatChange } from "./loadout.ts"
import type { ManifestItem, PlugFacts } from "./manifest.ts"
import { planSubclass, subclassSockets, unlockedPlugs } from "./subclass.ts"

const def = (hash: number, name: string, typeName: string): ManifestItem => ({
  hash,
  name,
  typeName,
  icon: null,
  tier: "unknown",
  slot: "other",
  damageType: "void",
  bucketHash: 0,
  classType: 0,
  description: "",
})

const defs = new Map(
  [
    def(1, "Sentinel Shield", "Super Ability"),
    def(2, "Ward of Dawn", "Super Ability"),
    def(10, "Empty Aspect Socket", ""),
    def(11, "Bastion", "Void Aspect"),
    def(12, "Controlled Demolition", "Void Aspect"),
    def(13, "Offensive Bulwark", "Void Aspect"),
    def(20, "Empty Fragment Socket", ""),
    def(21, "Echo of Starvation", "Void Fragment"),
    def(22, "Echo of Harvest", "Void Fragment"),
    def(23, "Echo of Undermining", "Void Fragment"),
    def(24, "Echo of Persistence", "Void Fragment"),
    def(25, "Echo of Reprisal", "Void Fragment"),
  ].map((d) => [d.hash, d]),
)

const SETS: Record<number, ReadonlyArray<number>> = {
  100: [1, 2],
  200: [10, 11, 12, 13],
  300: [20, 21, 22, 23, 24],
}

const sentinel = (plugs: ReadonlyArray<number>, enabled = plugs.map(() => true)) =>
  subclassSockets({
    subclass: { sockets: plugs.map((plugHash, i) => ({ plugHash, enabled: enabled[i] ?? true })) },
    plugSets: [100, 200, 200, 300, 300, 300, 300],
    unlocked: (set) => SETS[set] ?? [],
    defs,
  })

const SLOTS: Record<number, number> = { 11: 2, 12: 2, 13: 1 }
const plan = (
  plugs: ReadonlyArray<number>,
  request: Parameters<typeof planSubclass>[0]["request"],
) =>
  planSubclass({
    name: "Sentinel",
    sockets: sentinel(plugs),
    request,
    defs,
    fragmentSlots: (hash) => SLOTS[hash] ?? 0,
  })

describe("planSubclass", () => {
  test("a fragment the player has not unlocked is refused with what they do have", () => {
    const result = plan([1, 11, 13, 21, 22, 23, 20], { fragments: ["Echo of Reprisal"] })
    expect(result).toEqual({
      errors: [
        `"Echo of Reprisal" is not a fragment unlocked on Sentinel; pick from Echo of Starvation, Echo of Harvest, Echo of Undermining, Echo of Persistence`,
      ],
    })
  })

  test("fragments past the slots the chosen aspects give are refused", () => {
    const result = plan([1, 11, 12, 20, 20, 20, 20], {
      aspects: ["Bastion", "Offensive Bulwark"],
      fragments: [
        "Echo of Starvation",
        "Echo of Harvest",
        "Echo of Undermining",
        "Echo of Persistence",
      ],
    })
    expect(result).toEqual({ errors: ["the aspects give 3 fragment slots, not 4"] })
  })

  test("trading for a smaller aspect without naming fragments asks for them instead of dropping one", () => {
    const result = plan([1, 11, 12, 21, 22, 23, 24], { aspects: ["Bastion", "Offensive Bulwark"] })
    expect(result).toEqual({
      errors: [
        "the aspects give 3 fragment slots but 4 fragments are slotted; pass the fragments to keep",
      ],
    })
  })

  test("slotted plugs stay put, spare fragment slots keep theirs, only past the slots drop", () => {
    const result = plan([1, 11, 12, 21, 22, 23, 24], {
      super: "Ward of Dawn",
      aspects: ["Bastion", "Offensive Bulwark"],
      fragments: ["Echo of Undermining", "Echo of Starvation"],
    })
    if ("errors" in result) throw new Error(result.errors.join())
    expect(
      result.swaps.map((swap) => [swap.socketIndex, swap.plug.name, swap.previous?.name]),
    ).toEqual([
      [2, "Offensive Bulwark", "Controlled Demolition"],
      [0, "Ward of Dawn", "Sentinel Shield"],
    ])
    expect(result.loadout.super?.name).toBe("Ward of Dawn")
    expect(result.loadout.aspects.map((p) => p.name)).toEqual(["Bastion", "Offensive Bulwark"])
    expect(result.loadout.fragments.map((p) => p.name)).toEqual([
      "Echo of Starvation",
      "Echo of Harvest",
      "Echo of Undermining",
    ])
  })

  test("a new fragment takes an empty slot before it replaces one that is slotted", () => {
    const result = plan([1, 11, 12, 21, 20, 22, 20], {
      fragments: ["Echo of Persistence", "Echo of Undermining"],
    })
    if ("errors" in result) throw new Error(result.errors.join())
    expect(result.swaps.map((swap) => [swap.socketIndex, swap.plug.name])).toEqual([
      [4, "Echo of Persistence"],
      [6, "Echo of Undermining"],
    ])
    expect(result.loadout.fragments.map((p) => p.name)).toEqual([
      "Echo of Starvation",
      "Echo of Persistence",
      "Echo of Harvest",
      "Echo of Undermining",
    ])
  })

  test("a subclass named with nothing slotted asks for its super, aspects and fragments", () => {
    const result = plan([0, 10, 10, 20, 20, 20, 20], {})
    expect(result).toEqual({
      errors: [
        "Sentinel would have no super; name one in super",
        "2 aspect sockets on Sentinel would be empty; name the aspects",
      ],
    })
  })

  test("open fragment slots left empty are refused", () => {
    const result = plan([1, 11, 12, 21, 20, 22, 20], { fragments: ["Echo of Persistence"] })
    expect(result).toEqual({
      errors: ["1 of 4 fragment slots on Sentinel would be empty; name the fragments"],
    })
  })

  test("with every slot taken, a new fragment replaces the last one", () => {
    const result = plan([1, 11, 13, 21, 22, 23, 20], { fragments: ["Echo of Persistence"] })
    if ("errors" in result) throw new Error(result.errors.join())
    expect(
      result.swaps.map((swap) => [swap.socketIndex, swap.plug.name, swap.previous?.name]),
    ).toEqual([[5, "Echo of Persistence", "Echo of Undermining"]])
  })

  test("a request that matches what is slotted changes nothing", () => {
    const result = plan([1, 11, 12, 21, 22, 23, 24], {
      aspects: ["controlled demolition", "bastion"],
    })
    expect("swaps" in result && result.swaps).toEqual([])
  })
})

describe("unlockedPlugs", () => {
  test("joins account and character unlocks and leaves out what cannot be inserted", () => {
    const entry = (plugItemHash: number, canInsert = true) => ({
      plugItemHash,
      canInsert,
      enabled: true,
    })
    const sets = {
      profilePlugSets: { data: { plugs: { "300": [entry(21), entry(25, false)] } } },
      characterPlugSets: { data: { c1: { plugs: { "300": [entry(22)] } } } },
    }
    expect(unlockedPlugs(sets, "c1", 300)).toEqual([21, 22])
    expect(unlockedPlugs(sets, "c2", 300)).toEqual([21])
  })
})

describe("loadoutStatChange", () => {
  const facts = (
    mods: Record<string, number>,
    classMods: Record<string, number> = {},
  ): PlugFacts => ({
    mods,
    classMods,
    fragmentSlots: 0,
    energyCost: 0,
    category: "",
    artifact: false,
    charged: false,
    description: "",
  })

  test("takes out the equipped fragments' stats and adds the chosen ones'", () => {
    const plugs = new Map([
      [21, facts({ [STAT.strength]: 10 })],
      [22, facts({ [STAT.mobility]: -10 }, { [STAT.resilience]: 10, [STAT.recovery]: 10 })],
      [23, facts({ [STAT.intellect]: 10 })],
    ])
    expect(loadoutStatChange({ from: [21, 22], to: [22, 23], plugs, classType: "titan" })).toEqual({
      [STAT.intellect]: 10,
      [STAT.strength]: -10,
      [STAT.resilience]: 0,
      [STAT.mobility]: 0,
    })
    expect(loadoutStatChange({ from: [21], to: [22], plugs, classType: "titan" })).toEqual({
      [STAT.resilience]: 10,
      [STAT.mobility]: -10,
      [STAT.strength]: -10,
    })
  })
})
