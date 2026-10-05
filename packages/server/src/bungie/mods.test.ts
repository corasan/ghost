import { describe, expect, test } from "bun:test"
import { ChargeEffect, Source } from "@ghost/contract"
import { STAT } from "./inventory.ts"
import type { ArmorModEntry } from "./manifest.ts"
import {
  describeArmorMods,
  planModSwaps,
  type SocketNow,
  swapStatChange,
  withChargeEffects,
} from "./mods.ts"

const GENERAL = "enhancements.v2_general"
const ARMS = "enhancements.v2_arms"

const entry = (hash: number, name: string, patch: Partial<ArmorModEntry> = {}): ArmorModEntry => ({
  hash,
  name,
  icon: null,
  mods: {},
  classMods: {},
  fragmentSlots: 0,
  energyCost: 2,
  category: ARMS,
  artifact: false,
  charged: false,
  description: "",
  ...patch,
})

const superMod = entry(1, "Super Mod", {
  category: GENERAL,
  energyCost: 3,
  mods: { [STAT.intellect]: 10 },
})
const weaponsMod = entry(2, "Weapons Mod", {
  category: GENERAL,
  energyCost: 3,
  mods: { [STAT.mobility]: 10 },
})
const firepower = entry(3, "Firepower")
const cheapFirepower = entry(4, "Firepower", { energyCost: 1, artifact: true })
const heavyHanded = entry(5, "Heavy Handed", { energyCost: 3 })
const catalog = [superMod, weaponsMod, cheapFirepower, firepower, heavyHanded]

const socket = (index: number, category: string, holds?: ArmorModEntry): SocketNow => ({
  index,
  plugHash: holds?.hash ?? 900 + index,
  category,
  mod:
    holds === undefined
      ? null
      : {
          name: holds.name,
          icon: null,
          description: "",
          cost: holds.energyCost,
          charged: holds.charged,
          mods: holds.mods,
        },
})

const gauntlets = (used: number, sockets: ReadonlyArray<SocketNow>) => ({
  item: { name: "Bushido Gauntlets", modSockets: [], energy: { used, capacity: 10 } },
  sockets,
  catalog,
})

describe("planModSwaps", () => {
  test("a mod goes into a free socket of its kind, preferring the copy that needs no artifact", () => {
    const { swaps, errors } = planModSwaps({
      ...gauntlets(3, [socket(0, GENERAL, weaponsMod), socket(1, ARMS), socket(2, ARMS)]),
      requests: [{ mod: "firepower" }],
    })
    expect(errors).toEqual([])
    expect(swaps.map((swap) => [swap.socket.index, swap.entry.hash])).toEqual([[1, 3]])
  })

  test("a full piece needs to be told what to replace, and the swap frees that mod's energy", () => {
    const full = [socket(0, GENERAL, weaponsMod), socket(1, ARMS, heavyHanded)]
    expect(
      planModSwaps({ ...gauntlets(6, full), requests: [{ mod: "Super Mod" }] }).errors,
    ).toEqual(['Bushido Gauntlets has no free socket for "Super Mod"; say which mod it replaces'])
    const replaced = planModSwaps({
      ...gauntlets(6, full),
      requests: [{ mod: "Super Mod", replaces: "Weapons Mod" }],
    })
    expect(replaced.errors).toEqual([])
    expect(swapStatChange(replaced.swaps)).toEqual({
      [STAT.intellect]: 10,
      [STAT.mobility]: -10,
    })
  })

  test("a mod that would overdraw the piece's energy is refused with the numbers", () => {
    const { swaps, errors } = planModSwaps({
      ...gauntlets(9, [socket(0, GENERAL, weaponsMod), socket(1, ARMS)]),
      requests: [{ mod: "Heavy Handed" }],
    })
    expect(swaps).toEqual([])
    expect(errors).toEqual([
      '"Heavy Handed" costs 3 and would put Bushido Gauntlets at 12 of 10 energy',
    ])
  })

  test("a mod for another slot or one that does not exist is refused", () => {
    const helm = { ...gauntlets(0, [socket(0, GENERAL)]), requests: [{ mod: "Firepower" }] }
    expect(planModSwaps(helm).errors).toEqual([
      '"Firepower" is not a mod that fits Bushido Gauntlets; check list_armor_mods',
    ])
  })
})

describe("describeArmorMods", () => {
  const sockets = [
    socket(0, GENERAL, weaponsMod),
    socket(1, ARMS),
    socket(2, ARMS),
    socket(3, "core.gear_systems.armor_tiering.plugs.tuning.mods"),
  ]
  const { swaps } = planModSwaps({ ...gauntlets(3, sockets), requests: [{ mod: "Firepower" }] })
  const described = describeArmorMods({ sockets, swaps, facts: {} })

  test("lists what ends up slotted, marks the swap, and counts only build sockets as free", () => {
    expect(
      described.armorMods.map((mod) => [mod.name, mod.cost, mod.swap ?? false, mod.socketIndex]),
    ).toEqual([
      ["Weapons Mod", 3, false, undefined],
      ["Firepower", 2, true, 1],
    ])
    expect(described.armorMods[0]?.mods.map((m) => [m.label, m.delta])).toEqual([["WEAPONS", 10]])
    expect(described.freeModSlots).toBe(1)
    expect(described.energyUsed).toBe(5)
  })

  test("a swap remembers the plug it displaced so it can be undone", () => {
    expect(described.armorMods[1]).toMatchObject({ plugHash: 3, previousPlugHash: 901 })
  })
})

describe("withChargeEffects", () => {
  const surge = entry(6, "Arc Weapon Surge", { category: GENERAL, charged: true })
  const sockets = [socket(0, GENERAL, weaponsMod), socket(1, GENERAL, surge)]
  const { armorMods } = describeArmorMods({ sockets, swaps: [], facts: {} })
  const researched = new ChargeEffect({
    effect: "+10% Arc weapon damage",
    source: new Source({ label: "test", url: null, asOf: null }),
  })

  test("attaches researched numbers to charged mods only, matching names in any case", () => {
    const effects = new Map([
      ["arc weapon surge", researched],
      ["weapons mod", researched],
    ])
    expect(withChargeEffects(armorMods, effects).map((mod) => mod.chargeEffect?.effect)).toEqual([
      undefined,
      "+10% Arc weapon damage",
    ])
  })
})
