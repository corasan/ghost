import { describe, expect, test } from "bun:test"
import { LoadoutIdentity } from "@ghost/contract"
import { Schema } from "effect"
import {
  catalogFrom,
  type GameLoadout,
  LoadoutsResponse,
  parseLoadouts,
  slotsFor,
  validateSlot,
} from "./loadouts.ts"

const NONE = 2166136261

const filled = (ids: ReadonlyArray<string>) => ({
  colorHash: 3871954961,
  iconHash: 1143786713,
  nameHash: 752612098,
  items: ids.map((itemInstanceId) => ({ itemInstanceId, plugItemHashes: [NONE, 4026309323] })),
})

const empty = {
  colorHash: NONE,
  iconHash: NONE,
  nameHash: NONE,
  items: Array.from({ length: 10 }, () => ({ itemInstanceId: "0", plugItemHashes: [NONE] })),
}

const fixture = {
  profileProgression: { data: { seasonalArtifact: { artifactHash: 1497541105 } } },
  characterLoadouts: {
    data: {
      "2305843009309769093": {
        loadouts: [filled(["w1", "w2", "w3", "a1", "a2", "a3", "a4", "a5", "sub", "art"]), empty],
      },
      "2305843009309769094": { loadouts: [empty] },
    },
  },
}

describe("parseLoadouts", () => {
  const parsed = parseLoadouts(Schema.decodeUnknownSync(LoadoutsResponse)(fixture))

  test("keeps every slot in index order and strips the zero ids of an empty one", () => {
    const titan = parsed.byCharacter.get("2305843009309769093") ?? []
    expect(titan.map((slot) => slot.itemInstanceIds.length)).toEqual([10, 0])
    expect(titan[0]?.nameHash).toBe(752612098)
    expect(titan[1]?.index).toBe(1)
    expect(parsed.byCharacter.get("2305843009309769094")?.[0]?.itemInstanceIds).toEqual([])
  })

  test("reads the current artifact beside the loadouts", () => {
    expect(parsed.artifactHash).toBe(1497541105)
  })

  test("a response without component 206 has no loadouts and no artifact", () => {
    const none = parseLoadouts(Schema.decodeUnknownSync(LoadoutsResponse)({}))
    expect(none.byCharacter.size).toBe(0)
    expect(none.artifactHash).toBeNull()
  })
})

const catalog = catalogFrom({
  constants: {
    loadoutCountPerCharacter: 10,
    loadoutNameHashes: [752612103, 752612102],
    loadoutColorHashes: [3871954967],
    loadoutIconHashes: [1143786716],
  },
  names: [
    { hash: 752612102, name: "Bravo" },
    { hash: 752612103, name: "Alpha" },
  ],
  colors: [{ hash: 3871954967, colorImagePath: "/common/c.jpg" }],
  icons: [{ hash: 1143786716, iconImagePath: "/common/i.png" }],
})

const loadout = (index: number, ids: ReadonlyArray<string>): GameLoadout => ({
  index,
  nameHash: 752612103,
  colorHash: 3871954967,
  iconHash: 1143786716,
  itemInstanceIds: ids,
})

describe("catalogFrom", () => {
  test("orders identities as the constants list them and makes image paths absolute", () => {
    expect(catalog.names.map((name) => name.name)).toEqual(["Alpha", "Bravo"])
    expect(catalog.colors[0]?.icon).toBe("https://www.bungie.net/common/c.jpg")
    expect(catalog.icons[0]?.icon).toBe("https://www.bungie.net/common/i.png")
  })
})

describe("validateSlot", () => {
  const choice = {
    characterId: "c",
    index: 0,
    nameHash: 752612103,
    colorHash: 3871954967,
    iconHash: 1143786716,
  }

  test("accepts a slot the character has with identities from the catalog", () => {
    expect(validateSlot(choice, catalog, [])).toBeUndefined()
  })

  test("refuses a slot past the count, naming how many there are", () => {
    expect(validateSlot({ ...choice, index: 10 }, catalog, [])?.reason).toBe(
      "slot 11 does not exist; this character has 10 slots",
    )
  })

  test("allows the slots a character unlocked beyond the manifest count", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => loadout(index, []))
    expect(validateSlot({ ...choice, index: 10 }, catalog, twelve)).toBeUndefined()
  })

  test("refuses an identity hash the manifest does not list", () => {
    expect(validateSlot({ ...choice, nameHash: 1 }, catalog, [])?.reason).toBe(
      "1 is not a loadout name",
    )
    expect(validateSlot({ ...choice, colorHash: 2 }, catalog, [])?.reason).toBe(
      "2 is not a loadout color",
    )
    expect(validateSlot({ ...choice, iconHash: 3 }, catalog, [])?.reason).toBe(
      "3 is not a loadout icon",
    )
  })
})

describe("slotsFor", () => {
  test("resolves a filled slot's identity, marks empty ones, and names the build that claims each", () => {
    const slots = slotsFor([loadout(0, ["w1"]), loadout(1, [])], catalog, new Map([[0, "build-1"]]))
    expect(slots.slots).toHaveLength(10)
    expect(slots.slots[0]?.name).toEqual(
      new LoadoutIdentity({ hash: 752612103, name: "Alpha", icon: null }),
    )
    expect(slots.slots[0]?.savedBuildId).toBe("build-1")
    expect(slots.slots[1]?.empty).toBe(true)
    expect(slots.slots[1]?.name).toBeNull()
    expect(slots.slots[9]?.empty).toBe(true)
  })
})
