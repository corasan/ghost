import { describe, expect, test } from "bun:test"
import { buildInventory, isUpgrade, type OwnedItem, type Profile, STAT } from "./inventory.ts"
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
  [40, def(40, { name: "Firepower", typeName: "Arms Armor Mod" })],
  [41, def(41, { name: "Empty Mod Socket", typeName: "General Armor Mod" })],
  [42, def(42, { name: "Iron Shader", typeName: "Shader" })],
  [21, def(21, { name: "Lambda Shell", typeName: "Ghost Shell", icon: "https://b.net/shell.png" })],
  [30, def(30, { name: "Ward of Dawn", typeName: "Super Ability", description: "A dome." })],
  [31, def(31, { name: "Bastion", typeName: "Void Aspect" })],
  [32, def(32, { name: "Echo of Persistence", typeName: "Void Fragment" })],
  [33, def(33, { name: "Empty Fragment Socket", typeName: "Void Fragment" })],
  [34, def(34, { name: "Shield Bash", typeName: "Void Melee" })],
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
          { itemHash: 21, itemInstanceId: "g1", quantity: 1, bucketHash: BUCKETS.ghost },
        ],
      },
    },
  },
  itemComponents: {
    instances: {
      data: {
        v1: { damageType: 1, primaryStat: { value: 2000 } },
        e1: { primaryStat: { value: 1990 }, energy: { energyCapacity: 10, energyUsed: 3 } },
        v2: { primaryStat: { value: 1995 } },
      },
    },
    stats: { data: { e1: { stats: armorStats(10) }, v2: { stats: armorStats(12) } } },
    sockets: {
      data: {
        e1: { sockets: [{ plugHash: 42 }, { plugHash: 40 }, { plugHash: 41 }] },
        s1: {
          sockets: [
            { plugHash: 34 },
            { plugHash: 30 },
            { plugHash: 31 },
            { plugHash: 32 },
            { plugHash: 33 },
          ],
        },
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

const techsec = { name: "Techsec", items: [2], perks: [] }

const inv = buildInventory(profile, defs, seen, new Map([[2, techsec]]), new Map())

const fixture = <A>(value: A | undefined): A => {
  if (value === undefined) throw new Error("the fixture has no such entry")
  return value
}

const byId = (id: string) => fixture(inv.items.find((i) => i.itemInstanceId === id))

describe("buildInventory", () => {
  test("reads membership, characters and vault usage", () => {
    expect(inv.membershipType).toBe(3)
    expect(inv.membershipId).toBe("m1")
    expect(inv.characters.map((c) => c.characterId)).toEqual(["c2", "c1"])
    expect(inv.vaultCount).toBe(3)
    const titan = fixture(inv.characters[1])
    expect(titan.classType).toBe("titan")
    expect(titan.subclass).toBe("Sentinel")
    expect(titan.element).toBe("void")
    expect(titan.stats.resilience).toBe(100)
    expect(titan.postmasterCount).toBe(2)
    expect(titan.ghostIcon).toBe("https://b.net/shell.png")
    expect(inv.characters[0]?.ghostIcon).toBeNull()
  })

  test("sorts the subclass's plugs into super, aspects and fragments, without empty sockets", () => {
    const titan = fixture(inv.characters[1])
    expect(titan.loadout).toEqual({
      super: { hash: 30, name: "Ward of Dawn", description: "A dome.", icon: null },
      abilities: [{ hash: 34, name: "Shield Bash", description: "", icon: null, kind: "melee" }],
      aspects: [{ hash: 31, name: "Bastion", description: "", icon: null }],
      fragments: [{ hash: 32, name: "Echo of Persistence", description: "", icon: null }],
    })
    expect(fixture(inv.characters[0]).loadout).toEqual({
      super: null,
      abilities: [],
      aspects: [],
      fragments: [],
    })
  })

  test("armor lists its mod sockets in order, empty ones as null, and its energy", () => {
    expect(byId("e1").modSockets).toEqual([
      { index: 1, plugHash: 40, empty: false },
      { index: 2, plugHash: 41, empty: true },
    ])
    expect(byId("e1").energy).toEqual({ used: 3, capacity: 10 })
    expect(byId("v1").modSockets).toEqual([])
    expect(byId("v2").energy).toBeNull()
  })

  test("keeps instanced items only and never the subclass", () => {
    expect(inv.items.map((i) => i.itemInstanceId).sort()).toEqual(["e1", "g1", "p1", "v1", "v2"])
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

  test("equipped armor: stat total, class lock, duplicates, armor set", () => {
    const helm = byId("e1")
    expect(helm).toMatchObject({
      set: techsec,
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
  const titan = fixture(inv.characters.find((c) => c.characterId === "c1"))
  const hunter = fixture(inv.characters.find((c) => c.characterId === "c2"))
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

describe("buildInventory, rolled perks", () => {
  const rolled = new Map<number, ManifestItem>([
    [
      5,
      def(5, {
        name: "Solipsism",
        typeName: "Warlock Bond",
        tier: "exotic",
        bucketHash: BUCKETS.class,
        classType: 2,
      }),
    ],
    [50, def(50, { name: "Solipsism", typeName: "Intrinsic", description: "Two spirits." })],
    [51, def(51, { name: "Spirit of the Star-Eater", typeName: "Intrinsic", description: "A." })],
    [52, def(52, { name: "Spirit of Synthoceps", typeName: "Intrinsic", description: "B." })],
    [53, def(53, { name: "Upgrade Armor", typeName: "Intrinsic", description: "" })],
  ])
  const inv = buildInventory(
    {
      profileInventory: {
        data: {
          items: [
            { itemHash: 5, itemInstanceId: "x1", quantity: 1, bucketHash: BUCKETS.vault },
            { itemHash: 1, itemInstanceId: "w1", quantity: 1, bucketHash: BUCKETS.vault, state: 9 },
          ],
        },
      },
      itemComponents: {
        sockets: {
          data: {
            x1: {
              sockets: [{ plugHash: 50 }, { plugHash: 51 }, { plugHash: 52 }, { plugHash: 53 }],
            },
          },
        },
      },
    },
    new Map([...defs, ...rolled]),
    new Map(),
    new Map(),
    new Map(),
  )
  const item = (id: string) => inv.items.find((i) => i.itemInstanceId === id)

  test("keeps every perk an exotic class item rolled, not only its first", () => {
    expect(item("x1")?.intrinsics).toEqual([
      "Solipsism",
      "Spirit of the Star-Eater",
      "Spirit of Synthoceps",
    ])
    expect(item("x1")?.exoticPerk?.name).toBe("Solipsism")
  })

  test("reads the crafted bit apart from the lock", () => {
    expect([item("w1")?.crafted, item("w1")?.locked, item("x1")?.crafted]).toEqual([
      true,
      true,
      false,
    ])
  })
})

describe("buildInventory, tuning", () => {
  const BALANCED = 60
  const tuningMods = new Map<number, string | null>([
    [BALANCED, null],
    [61, STAT.recovery],
    [62, STAT.recovery],
    [63, STAT.mobility],
  ])
  const armor = (id: string) => ({
    itemHash: 2,
    itemInstanceId: id,
    quantity: 1,
    bucketHash: BUCKETS.vault,
  })
  const tuningOf = (mods: ReadonlyMap<number, string | null>) =>
    Object.fromEntries(
      buildInventory(
        {
          profileInventory: {
            data: { items: [armor("legendary"), armor("exotic"), armor("lower"), armor("bare")] },
          },
          itemComponents: {
            reusablePlugs: {
              data: {
                legendary: {
                  plugs: {
                    "6": [{ plugItemHash: 40 }],
                    "11": [{ plugItemHash: BALANCED }, { plugItemHash: 61 }, { plugItemHash: 62 }],
                  },
                },
                exotic: {
                  plugs: {
                    "11": [{ plugItemHash: BALANCED }, { plugItemHash: 61 }, { plugItemHash: 63 }],
                  },
                },
                lower: { plugs: { "11": [{ plugItemHash: BALANCED }] } },
              },
            },
          },
        },
        defs,
        new Map(),
        new Map(),
        mods,
      ).items.map((item) => [item.itemInstanceId, item.tuning]),
    )

  test("names the stat a piece's tuning mods raise, from its reusable plugs", () => {
    expect(tuningOf(tuningMods)).toEqual({
      legendary: "recovery",
      exotic: "any",
      lower: "balanced",
      bare: null,
    })
  })

  test("leaves tuning unread when the tuning mods are not known", () => {
    expect(tuningOf(new Map())).toEqual({
      legendary: null,
      exotic: null,
      lower: null,
      bare: null,
    })
  })
})
