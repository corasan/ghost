import { describe, expect, test } from "bun:test"
import {
  buildInventory,
  type CharacterInfo,
  isUpgrade,
  type OwnedItem,
  type Profile,
  STAT,
} from "./inventory.ts"
import { BUCKETS, type ManifestItem } from "./manifest.ts"

const def = (hash: number, fields: Partial<ManifestItem>): ManifestItem => ({
  hash,
  name: `Item ${hash}`,
  typeName: "",
  icon: null,
  tier: "legendary",
  slot: "other",
  damageType: "none",
  bucketHash: 0,
  classType: 3,
  description: "",
  ...fields,
})

const defs = new Map<number, ManifestItem>([
  [1, def(1, { name: "Fatebringer", typeName: "Hand Cannon", bucketHash: BUCKETS.kinetic })],
  [2, def(2, { name: "Iron Helm", typeName: "Helmet", bucketHash: BUCKETS.helmet, classType: 0 })],
  [
    3,
    def(3, {
      name: "Gjallarhorn",
      typeName: "Rocket Launcher",
      tier: "exotic",
      bucketHash: BUCKETS.power,
    }),
  ],
  [10, def(10, { name: "Explosive Payload", typeName: "Trait" })],
  [11, def(11, { name: "Firefly", typeName: "Enhanced Trait" })],
  [12, def(12, { name: "Arrowhead Brake", typeName: "Barrel" })],
  [20, def(20, { name: "Sentinel", typeName: "Void Subclass", damageType: "void" })],
])

const armorStats = (each: number) =>
  Object.fromEntries(Object.values(STAT).map((hash) => [hash, { value: each }]))

const profile: Profile = {
  profile: { data: { userInfo: { membershipType: 3, membershipId: "m1" } } },
  profileInventory: {
    data: {
      items: [
        { itemHash: 1, itemInstanceId: "v1", quantity: 1, bucketHash: BUCKETS.vault, state: 5 },
        { itemHash: 2, itemInstanceId: "v2", quantity: 1, bucketHash: BUCKETS.vault },
        // A stack of materials: counts toward vault space, not an owned item.
        { itemHash: 99, quantity: 20, bucketHash: BUCKETS.vault },
      ],
    },
  },
  characters: {
    data: {
      c1: { characterId: "c1", classType: 0, light: 2010, stats: { [STAT.resilience]: 100 } },
      c2: { characterId: "c2", classType: 1, light: 2020, stats: {} },
    },
  },
  characterInventories: {
    data: {
      c1: {
        items: [
          { itemHash: 3, itemInstanceId: "p1", quantity: 1, bucketHash: BUCKETS.postmaster },
          { itemHash: 98, quantity: 3, bucketHash: BUCKETS.postmaster },
        ],
      },
    },
  },
  characterEquipment: {
    data: {
      c1: {
        items: [
          { itemHash: 2, itemInstanceId: "e1", quantity: 1, bucketHash: BUCKETS.helmet, state: 1 },
          { itemHash: 20, itemInstanceId: "s1", quantity: 1, bucketHash: BUCKETS.subclass },
        ],
      },
    },
  },
  itemComponents: {
    instances: {
      data: {
        v1: { damageType: 1, primaryStat: { value: 2000 } },
        e1: { primaryStat: { value: 1990 } },
        v2: { primaryStat: { value: 1995 } },
      },
    },
    stats: { data: { e1: { stats: armorStats(10) }, v2: { stats: armorStats(12) } } },
    sockets: {
      data: {
        v1: {
          sockets: [
            { plugHash: 12, isEnabled: true, isVisible: true },
            { plugHash: 10, isEnabled: true, isVisible: true },
            { plugHash: 11, isEnabled: true, isVisible: true },
            { plugHash: 10, isEnabled: false, isVisible: true },
          ],
        },
      },
    },
  },
}

const seen = new Map([
  ["v1", { decision: "keep" as const, firstSeenAt: "2026-10-01T00:00:00.000Z", baseline: false }],
  ["v2", { decision: null, firstSeenAt: "2026-09-01T00:00:00.000Z", baseline: true }],
])

const inv = buildInventory(profile, defs, seen)
const byId = (id: string) => inv.items.find((i) => i.itemInstanceId === id) as OwnedItem

describe("buildInventory", () => {
  test("reads membership, characters and vault usage", () => {
    expect(inv.membershipType).toBe(3)
    expect(inv.membershipId).toBe("m1")
    expect(inv.characters.map((c) => c.characterId)).toEqual(["c2", "c1"])
    expect(inv.vaultCount).toBe(3)
    const titan = inv.characters[1] as CharacterInfo
    expect(titan.classType).toBe("titan")
    expect(titan.subclass).toBe("Sentinel")
    expect(titan.element).toBe("void")
    expect(titan.stats.resilience).toBe(100)
    expect(titan.postmasterCount).toBe(2)
  })

  test("keeps instanced items only and never the subclass", () => {
    expect(inv.items.map((i) => i.itemInstanceId).sort()).toEqual(["e1", "p1", "v1", "v2"])
  })

  test("vault weapon: slot from definition, element, state bits, trait perks in order", () => {
    const weapon = byId("v1")
    expect(weapon).toMatchObject({
      location: "vault",
      characterId: null,
      slot: "kinetic",
      damageType: "kinetic",
      power: 2000,
      locked: true,
      masterwork: true,
      statTotal: null,
      classType: null,
      perks: ["Explosive Payload", "Firefly"],
      decision: "keep",
      acquiredAt: "2026-10-01T00:00:00.000Z",
    })
    expect(weapon.plugHashes).toEqual([12, 10, 11])
  })

  test("equipped armor: stat total, class lock, duplicates", () => {
    const helm = byId("e1")
    expect(helm).toMatchObject({
      location: "character",
      characterId: "c1",
      equipped: true,
      slot: "helmet",
      classType: "titan",
      statTotal: 60,
      locked: true,
      masterwork: false,
      duplicates: 1,
      perks: [],
      acquiredAt: null,
    })
    // Baseline items were owned before Ghost first looked, so no acquired time.
    expect(byId("v2").acquiredAt).toBeNull()
    expect(byId("v2").duplicates).toBe(1)
  })

  test("postmaster item takes its slot from the definition", () => {
    expect(byId("p1")).toMatchObject({ location: "postmaster", characterId: "c1", slot: "power" })
  })
})

describe("isUpgrade", () => {
  const titan = inv.characters.find((c) => c.characterId === "c1") as CharacterInfo
  const hunter = inv.characters.find((c) => c.characterId === "c2") as CharacterInfo
  const item = (fields: Partial<OwnedItem>): OwnedItem => ({ ...byId("v2"), ...fields })

  test("armor needs more than 2 points over what is equipped", () => {
    expect(isUpgrade(item({ statTotal: 63 }), titan, inv.items)).toBe(true)
    expect(isUpgrade(item({ statTotal: 62 }), titan, inv.items)).toBe(false)
  })

  test("class-locked armor only counts for its class", () => {
    expect(isUpgrade(item({ statTotal: 80 }), hunter, inv.items)).toBe(false)
  })

  test("exotic armor only replaces an equipped exotic", () => {
    expect(isUpgrade(item({ statTotal: 80, tier: "exotic" }), titan, inv.items)).toBe(false)
    const withExotic = inv.items.map((i) =>
      i.itemInstanceId === "e1" ? { ...i, tier: "exotic" as const } : i,
    )
    expect(isUpgrade(item({ statTotal: 80, tier: "exotic" }), titan, withExotic)).toBe(true)
  })

  test("weapons compare power, and an empty slot is never an upgrade", () => {
    const equippedWeapon = {
      ...byId("v1"),
      itemInstanceId: "w0",
      equipped: true,
      characterId: "c1",
      location: "character" as const,
    }
    const items = [...inv.items, equippedWeapon]
    expect(isUpgrade(byId("v1"), titan, inv.items)).toBe(false)
    expect(isUpgrade({ ...byId("v1"), power: 2001 }, titan, items)).toBe(true)
    expect(isUpgrade({ ...byId("v1"), power: 2000 }, titan, items)).toBe(false)
  })

  test("the equipped item itself is not an upgrade", () => {
    expect(isUpgrade(byId("e1"), titan, inv.items)).toBe(false)
  })
})
