import { describe, expect, test } from "bun:test"
import { STAT } from "./inventory.ts"
import { describeArmorMods, describeLoadout } from "./loadout.ts"
import type { ManifestItem } from "./manifest.ts"

describe("describeLoadout", () => {
  const plug = (hash: number, name: string, description = "") => ({
    hash,
    name,
    description,
    icon: null,
  })
  const loadout = describeLoadout({
    character: {
      classType: "titan",
      subclass: "Sunbreaker",
      subclassIcon: null,
      element: "solar",
      loadout: {
        super: plug(9, "Hammer of Sol", "Throw hammers."),
        abilities: [{ ...plug(8, "Rally Barricade"), kind: "class" }],
        aspects: [plug(3, "Sol Invictus")],
        fragments: [plug(1, "Ember of Searing"), plug(2, "Ember of Solace")],
      },
    },
    plugs: new Map([
      [
        1,
        {
          mods: { [STAT.mobility]: 10 },
          classMods: { [STAT.resilience]: -10, [STAT.recovery]: -10 },
          fragmentSlots: 0,
          energyCost: 0,
          description: "",
        },
      ],
      [
        3,
        {
          mods: {},
          classMods: {},
          fragmentSlots: 2,
          energyCost: 0,
          description: "Kills leave Sunspots.",
        },
      ],
    ]),
    facts: { [STAT.mobility]: { name: "Weapons", effect: "" } },
  })

  test("a class penalty lands only on that class's stat, under the label the stats use", () => {
    expect(loadout.fragments.map((f) => f.mods.map((m) => [m.label, m.delta]))).toEqual([
      [
        ["HEALTH", -10],
        ["WEAPONS", 10],
      ],
      [],
    ])
  })

  test("an aspect gets its slots and the effect text its item definition lacks", () => {
    expect(loadout.aspects[0]).toMatchObject({
      description: "Kills leave Sunspots.",
      fragmentSlots: 2,
    })
    expect(loadout.super?.description).toBe("Throw hammers.")
    expect(loadout.fragments[0]?.fragmentSlots).toBeUndefined()
  })
})

describe("describeArmorMods", () => {
  const def = (hash: number, name: string, description = ""): [number, ManifestItem] => [
    hash,
    {
      hash,
      name,
      typeName: "General Armor Mod",
      icon: null,
      tier: "common",
      slot: "other",
      damageType: "none",
      bucketHash: 0,
      classType: 3,
      description,
    },
  ]
  const mods = describeArmorMods({
    item: { modSlots: [7, null, 8, 99] },
    defs: new Map([def(7, "Super Mod"), def(8, "Firepower", "Reloads on orb pickup.")]),
    plugs: new Map([
      [
        7,
        {
          mods: { [STAT.intellect]: 10 },
          classMods: {},
          fragmentSlots: 0,
          energyCost: 3,
          description: "",
        },
      ],
    ]),
    facts: {},
  })

  test("lists slotted mods with their cost and stat change, skipping empty and unknown sockets", () => {
    expect(
      mods.map((mod) => [mod.name, mod.cost, mod.mods.map((m) => [m.label, m.delta])]),
    ).toEqual([
      ["Super Mod", 3, [["SUPER", 10]]],
      ["Firepower", 0, []],
    ])
    expect(mods[1]?.description).toBe("Reloads on orb pickup.")
  })
})
