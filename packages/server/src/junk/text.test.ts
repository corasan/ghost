import { describe, expect, test } from "bun:test"
import type { OwnedItem } from "../bungie/inventory.ts"
import type { ManifestItem } from "../bungie/manifest.ts"
import { itemText, rollLines } from "./text.ts"

const plate = (tuning: OwnedItem["tuning"]): OwnedItem => ({
  itemInstanceId: "p1",
  itemHash: 9,
  name: "Iron Battalion Plate",
  typeName: "Chest Armor",
  icon: null,
  tier: "legendary",
  slot: "chest",
  damageType: "none",
  power: 514,
  quantity: 1,
  location: "vault",
  characterId: null,
  equipped: false,
  classType: "titan",
  locked: false,
  masterwork: false,
  gearTier: 5,
  statTotal: 75,
  perks: [],
  duplicates: 1,
  decision: null,
  acquiredAt: null,
  armorStats: {
    mobility: 0,
    resilience: 20,
    recovery: 25,
    discipline: 30,
    intellect: 0,
    strength: 0,
  },
  plugHashes: [],
  modSockets: [],
  energy: null,
  exoticPerk: null,
  intrinsics: [],
  set: null,
  crafted: false,
  tuning,
})

describe("itemText", () => {
  test("tells Jev which stat a tier 5 piece is tuned to", () => {
    expect(itemText(plate("recovery"), new Map())).toContain("tuned stat Class")
    expect(itemText(plate("recovery"), new Map())).not.toEqual(
      itemText(plate("mobility"), new Map()),
    )
  })
})

const plug = (hash: number, name: string, typeName: string): ManifestItem => ({
  hash,
  name,
  typeName,
  icon: null,
  tier: "common",
  slot: "other",
  damageType: "none",
  bucketHash: 0,
  classType: 3,
  description: "",
})

const plugs = new Map(
  [
    plug(1, "Arrowhead Brake", "Barrel"),
    plug(2, "Ricochet Rounds", "Magazine"),
    plug(3, "Rapid Hit", "Trait"),
    plug(4, "Kill Clip", "Enhanced Trait"),
    plug(5, "Default Shader", "Shader"),
    plug(6, "Kill Tracker", "Tracker"),
    plug(7, "Empty Mod Socket", "Weapon Mod"),
  ].map((p) => [p.hash, p]),
)

describe("rollLines", () => {
  test("reads the same roll the same way whatever order the sockets come in", () => {
    expect(rollLines([4, 3, 2, 1], plugs)).toEqual(rollLines([1, 2, 3, 4], plugs))
  })

  test("names each perk with its column and leaves out cosmetics and empty sockets", () => {
    expect(rollLines([1, 2, 3, 4, 5, 6, 7], plugs)).toEqual([
      "Barrel: Arrowhead Brake",
      "Enhanced Trait: Kill Clip",
      "Magazine: Ricochet Rounds",
      "Trait: Rapid Hit",
    ])
  })
})
