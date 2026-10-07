import { describe, expect, test } from "bun:test"
import { type ItemSlot, LoadoutPlug, Plan, PlanRow, SubclassLoadout } from "@ghost/contract"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { drift } from "./drift.ts"

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 100,
  name: `Item ${id}`,
  typeName: "Armor",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "none",
  power: 550,
  quantity: 1,
  location: "character",
  characterId: "titan-1",
  equipped: true,
  classType: "titan",
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
  energy: null,
  exoticPerk: null,
  set: null,
  crafted: false,
  ...fields,
})

const plug = (name: string) => ({ hash: 1, name, description: "", icon: null })
const planned = (name: string) => new LoadoutPlug({ name, description: "", mods: [] })

const titan = (fields: Partial<CharacterInfo> = {}): CharacterInfo => ({
  characterId: "titan-1",
  classType: "titan",
  light: 550,
  subclass: "Sentinel",
  subclassIcon: null,
  ghostIcon: null,
  element: "void",
  loadout: {
    super: null,
    abilities: [],
    aspects: [plug("Bastion"), plug("Unbreakable")],
    fragments: [plug("Echo of Persistence")],
  },
  subclasses: [],
  stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
  postmasterCount: 0,
  ...fields,
})

const row = (item: OwnedItem, action: PlanRow["action"], selected = true) =>
  new PlanRow({
    itemInstanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: item.name,
    icon: null,
    tier: item.tier,
    meta: "",
    power: item.power,
    score: null,
    action,
    characterId: "titan-1",
    selected,
    outcome: null,
    error: null,
  })

const loadout = (fields: Partial<SubclassLoadout> = {}) =>
  new SubclassLoadout({
    classType: "titan",
    subclass: "Sentinel",
    element: "void",
    super: null,
    aspects: [planned("Unbreakable"), planned("Bastion")],
    fragments: [planned("Echo of Persistence")],
    ...fields,
  })

const plan = (rows: ReadonlyArray<PlanRow>, subclass?: SubclassLoadout) =>
  new Plan({
    kind: "build",
    title: "BUILD PLAN",
    subtitle: null,
    stats: [],
    featured: null,
    rows,
    note: null,
    confirmLabel: "APPLY BUILD",
    status: "applied",
    loadout: subclass,
  })

const inventory = (items: ReadonlyArray<OwnedItem>, character = titan()): Inventory => ({
  membershipType: 3,
  membershipId: "m",
  characters: [character],
  items,
  vaultCount: 0,
})

describe("drift", () => {
  const helm = owned("helm", "helmet")

  test("is empty when every kept piece is on and the subclass plugs match in any order", () => {
    expect(drift(plan([row(helm, "none")], loadout()), inventory([helm]), "titan-1")).toEqual([])
  })

  test("counts an unticked piece that stayed in the vault", () => {
    const chest = owned("chest", "chest", { location: "vault", characterId: null, equipped: false })
    expect(
      drift(
        plan([row(helm, "none"), row(chest, "equip", false)]),
        inventory([helm, chest]),
        "titan-1",
      ),
    ).toEqual(["Item chest is not equipped"])
  })

  test("counts a piece equipped on another character", () => {
    const elsewhere = owned("helm", "helmet", { characterId: "hunter-1" })
    expect(drift(plan([row(helm, "equip")]), inventory([elsewhere]), "titan-1")).toEqual([
      "Item helm is not equipped",
    ])
  })

  test("names the subclass that is on instead of the planned one", () => {
    expect(
      drift(plan([], loadout()), inventory([], titan({ subclass: "Striker" })), "titan-1"),
    ).toEqual(["Striker is equipped, not Sentinel"])
  })

  test("tells apart aspects and fragments that are not as planned", () => {
    const worn = titan({
      loadout: { super: null, abilities: [], aspects: [plug("Bastion")], fragments: [] },
    })
    expect(drift(plan([], loadout()), inventory([], worn), "titan-1")).toEqual([
      "the aspects are not as planned",
      "the fragments are not as planned",
    ])
  })
})
