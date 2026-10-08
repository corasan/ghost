import { describe, expect, test } from "bun:test"
import type { ItemSlot } from "@ghost/contract"
import {
  BUCKETS,
  capacitiesFrom,
  FALLBACK_CAPACITIES,
  type ManifestItem,
} from "../bungie/manifest.ts"
import type { OwnedItem } from "../bungie/inventory.ts"
import { describeAction, perksFrom, pieceSetBonuses } from "./items.ts"

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

describe("pieceSetBonuses", () => {
  const techsec = {
    name: "Techsec",
    items: [11, 12, 13, 14],
    perks: [
      { name: "Techsec Four", description: "Four.", icon: null, required: 4 },
      { name: "Techsec Two", description: "Two.", icon: null, required: 2 },
    ],
  }
  const piece = (
    id: string,
    itemHash: number,
    slot: ItemSlot,
    fields: Partial<OwnedItem> = {},
  ) => ({
    itemInstanceId: id,
    itemHash,
    name: `Piece ${id}`,
    typeName: "Helmet",
    icon: null,
    tier: "legendary" as const,
    slot,
    damageType: "none" as const,
    power: 550,
    quantity: 1,
    location: "character" as const,
    characterId: "c1",
    equipped: true,
    classType: "titan" as const,
    locked: false,
    masterwork: false,
    statTotal: 60,
    perks: [],
    duplicates: 0,
    decision: null,
    acquiredAt: null,
    armorStats: null,
    plugHashes: [],
    modSockets: [],
    weaponSockets: [],
    weaponStats: {},
    energy: null,
    exoticPerk: null,
    intrinsics: [],
    crafted: false,
    tuning: null,
    traits: [],
    set: techsec,
    ...fields,
  })
  const worn = [
    piece("a", 11, "helmet"),
    piece("b", 12, "arms"),
    piece("c", 13, "chest"),
    piece("d", 14, "legs", { characterId: "c2" }),
    piece("e", 12, "arms", { equipped: false }),
    piece("f", 99, "class", { set: null }),
  ]
  const bonuses = (item: OwnedItem) =>
    pieceSetBonuses(item, worn)?.map((bonus) => [bonus.name, bonus.required, bonus.worn])

  test("lists every bonus of the set, counting what the piece's character wears", () => {
    expect(bonuses(piece("e", 12, "arms", { equipped: false }))).toEqual([
      ["Techsec Two", 2, 3],
      ["Techsec Four", 4, 3],
    ])
  })

  test("counts nothing worn for a piece in the vault or postmaster", () => {
    expect(bonuses(piece("v", 14, "legs", { location: "vault", characterId: null }))).toEqual([
      ["Techsec Two", 2, 0],
      ["Techsec Four", 4, 0],
    ])
    expect(bonuses(piece("p", 14, "legs", { location: "postmaster", equipped: false }))).toEqual([
      ["Techsec Two", 2, 0],
      ["Techsec Four", 4, 0],
    ])
  })

  test("is absent for a piece in no set", () => {
    expect(pieceSetBonuses(piece("f", 99, "class", { set: null }), worn)).toBeUndefined()
  })
})
