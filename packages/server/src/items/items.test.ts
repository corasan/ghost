import { describe, expect, test } from "bun:test"
import {
  BUCKETS,
  capacitiesFrom,
  FALLBACK_CAPACITIES,
  type ManifestItem,
} from "../bungie/manifest.ts"
import { describeAction, perksFrom } from "./items.ts"

const plug = (hash: number, patch: Partial<ManifestItem>): [number, ManifestItem] => [
  hash,
  {
    hash,
    name: "Plug",
    typeName: "Trait",
    icon: null,
    tier: "common",
    slot: "other",
    damageType: "none",
    bucketHash: 0,
    classType: 3,
    description: "Does a thing.",
    ...patch,
  },
]

describe("perksFrom", () => {
  const defs = new Map([
    plug(1, { name: "Tactical Mag", typeName: "Magazine" }),
    plug(2, { name: "Bait and Switch", typeName: "Trait" }),
    plug(3, { name: "Default Shader", typeName: "Shader" }),
    plug(4, { name: "Kill Tracker", typeName: "Weapon Mod" }),
    plug(5, { name: "Empty Mod Socket", typeName: "Weapon Mod" }),
    plug(6, { name: "Mystery", typeName: "Intrinsic", description: "" }),
    plug(7, { name: "Attrition Orbs", typeName: "Enhanced Trait" }),
  ])

  test("keeps real perks in socket order and marks the traits", () => {
    expect(perksFrom([1, 2], defs).map((perk) => [perk.name, perk.trait])).toEqual([
      ["Tactical Mag", false],
      ["Bait and Switch", true],
    ])
  })

  test("marks enhanced perks, which are still traits", () => {
    expect(perksFrom([2, 7], defs).map((perk) => [perk.name, perk.trait, perk.enhanced])).toEqual([
      ["Bait and Switch", true, false],
      ["Attrition Orbs", true, true],
    ])
  })

  test("drops cosmetics, trackers, empty sockets, undescribed and unknown plugs", () => {
    expect(perksFrom([3, 4, 5, 6, 999], defs)).toEqual([])
  })
})

describe("describeAction", () => {
  const item = { name: "Mint Retrograde" }

  test("names the class a transfer or equip targets", () => {
    expect(describeAction(item, "to_character", { classType: "titan" }).prompt).toBe(
      "Send Mint Retrograde to Titan",
    )
    expect(describeAction(item, "equip", { classType: "hunter" }).confirmLabel).toBe(
      "EQUIP ON HUNTER",
    )
  })

  test("a vault transfer needs no character", () => {
    expect(describeAction(item, "to_vault", undefined)).toMatchObject({
      prompt: "Send Mint Retrograde to the vault",
      meta: "TO VAULT",
    })
  })
})

describe("capacitiesFrom", () => {
  test("reads the vault and postmaster sizes from Bungie's bucket definitions", () => {
    expect(
      capacitiesFrom({
        [BUCKETS.vault]: { itemCount: 1300 },
        [BUCKETS.postmaster]: { itemCount: 21 },
      }),
    ).toEqual({ vault: 1300, postmaster: 21 })
  })

  test("falls back when a bucket is missing or reports no size", () => {
    expect(capacitiesFrom({ [BUCKETS.vault]: { itemCount: 0 } })).toEqual(FALLBACK_CAPACITIES)
  })
})
