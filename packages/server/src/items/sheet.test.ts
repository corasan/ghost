import { describe, expect, test } from "bun:test"
import type { OwnedItem } from "../bungie/inventory.ts"
import type { ManifestItem } from "../bungie/manifest.ts"
import { isPerk } from "./items.ts"
import { poolColumns, weaponSheet } from "./sheet.ts"

const plug = (hash: number, name: string, typeName: string): [number, ManifestItem] => [
  hash,
  {
    hash,
    name,
    typeName,
    icon: null,
    tier: "common",
    slot: "other",
    damageType: "none",
    bucketHash: 0,
    classType: 3,
    description: `${name} does a thing.`,
  },
]

const defs = new Map([
  plug(10, "Smallbore", "Barrel"),
  plug(11, "Fluted Barrel", "Barrel"),
  plug(20, "Tactical Mag", "Magazine"),
  plug(30, "Outlaw", "Trait"),
  plug(31, "Rangefinder", "Trait"),
  plug(32, "Rangefinder", "Enhanced Trait"),
  plug(33, "Kill Clip", "Trait"),
  plug(40, "Eye of the Storm", "Trait"),
  plug(50, "Kill Tracker", "Tracker"),
])

const item: Pick<OwnedItem, "weaponSockets" | "weaponStats"> = {
  weaponSockets: [
    { index: 1, plugHash: 10, rolled: [10, 11] },
    { index: 2, plugHash: 20, rolled: [] },
    { index: 3, plugHash: 32, rolled: [30, 32] },
    { index: 4, plugHash: 40, rolled: [] },
    { index: 8, plugHash: 50, rolled: [] },
  ],
  weaponStats: { "1240592695": 40, "155624089": 30, "4284893193": 140 },
}

const pools = [
  { index: 1, pool: [11, 10] },
  { index: 2, pool: [20] },
  { index: 3, pool: [30, 31, 33] },
  { index: 4, pool: [40] },
  { index: 8, pool: [50] },
]

describe("poolColumns", () => {
  const columns = poolColumns(item, pools, defs, isPerk)
  const summary = columns.map((column) => [
    column.label,
    column.plugs.map(
      ({ plug, active, rolled }) =>
        `${plug.hash}${active ? " active" : ""}${rolled && !active ? " rolled" : ""}`,
    ),
  ])

  test("labels each perk socket and lists its pool, skipping sockets that hold no perk", () => {
    expect(summary).toEqual([
      ["BARREL", ["11 rolled", "10 active"]],
      ["MAG", ["20 active"]],
      ["TRAIT 1", ["30 rolled", "32 active", "33"]],
      ["TRAIT 2", ["40 active"]],
    ])
  })

  test("lets the copy's enhanced perk stand in for the plain one in the pool", () => {
    const names = columns[2]?.plugs.map((each) => each.plug.name)
    expect(names).toEqual(["Outlaw", "Rangefinder", "Kill Clip"])
  })
})

describe("weaponSheet", () => {
  const columns = poolColumns(item, pools, defs, isPerk)
  const investments = new Map([
    [10, { "1240592695": 8, "155624089": 6 }],
    [11, { "943549884": 10, "1240592695": -3 }],
    [32, { "1240592695": 60 }],
    [20, { "155624089": -4, "3291498656": 9 }],
  ])
  const sheet = weaponSheet(item, columns, [], investments)

  test("splits each stat into what the active perks bring, never past the stat itself", () => {
    expect(sheet.stats.map((stat) => [stat.name, stat.value, stat.fromPerks, stat.bar])).toEqual([
      ["Range", 40, 40, true],
      ["Stability", 30, 2, true],
      ["RPM", 140, 0, false],
    ])
  })

  test("names each perk's stat changes, leaving out stats this weapon does not show", () => {
    const mag = sheet.columns[1]?.perks[0]
    const fluted = sheet.columns[0]?.perks[0]
    expect(mag?.stats.map((change) => [change.stat, change.value])).toEqual([["Stability", -4]])
    expect(fluted?.stats.map((change) => [change.stat, change.value])).toEqual([["Range", -3]])
    expect(sheet.columns[0]?.perks[0]?.rolled).toBe(true)
    expect(sheet.columns[2]?.perks[2]?.rolled).toBe(false)
  })
})
