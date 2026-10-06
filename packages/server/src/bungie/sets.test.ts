import { describe, expect, test } from "bun:test"
import type { ArmorSet } from "./manifest.ts"
import { isActive, setBonusesFor } from "./sets.ts"

const perk = (name: string, required: number) => ({
  name,
  description: `${name} effect`,
  icon: null,
  required,
})

const techsec: ArmorSet = {
  name: "Techsec",
  items: [11, 12, 13, 14, 15],
  perks: [perk("Techsec Four", 4), perk("Techsec Two", 2)],
}

const aion: ArmorSet = {
  name: "AION Renewal",
  items: [21, 22, 23, 24, 25],
  perks: [perk("Force Converter", 2), perk("AION Four", 4)],
}

const bonuses = (itemHashes: ReadonlyArray<number>) =>
  setBonusesFor([techsec, aion], itemHashes).map((bonus) => [
    bonus.name,
    bonus.worn,
    isActive(bonus) ? "on" : "one away",
  ])

describe("setBonusesFor", () => {
  test("a bonus turns on at exactly the pieces it needs and is one away a piece short", () => {
    expect(bonuses([31, 32, 33, 34, 35])).toEqual([])
    expect(bonuses([11, 31, 32, 33, 34])).toEqual([["Techsec Two", 1, "one away"]])
    expect(bonuses([11, 12, 31, 32, 33])).toEqual([["Techsec Two", 2, "on"]])
    expect(bonuses([11, 12, 13, 31, 32])).toEqual([
      ["Techsec Two", 3, "on"],
      ["Techsec Four", 3, "one away"],
    ])
    expect(bonuses([11, 12, 13, 14, 31])).toEqual([
      ["Techsec Two", 4, "on"],
      ["Techsec Four", 4, "on"],
    ])
  })

  test("leaves out a bonus two pieces away", () => {
    expect(bonuses([11, 12, 31, 32, 33]).map(([name]) => name)).not.toContain("Techsec Four")
  })

  test("lists active bonuses before those one away, each set counting only its own pieces", () => {
    expect(bonuses([11, 21, 22, 23, 31])).toEqual([
      ["Force Converter", 3, "on"],
      ["Techsec Two", 1, "one away"],
      ["AION Four", 3, "one away"],
    ])
    expect(bonuses([11, 12, 13, 14, 21])).toEqual([
      ["Techsec Two", 4, "on"],
      ["Techsec Four", 4, "on"],
      ["Force Converter", 1, "one away"],
    ])
  })

  test("the same piece listed twice counts once", () => {
    expect(bonuses([11, 11, 21, 21, 21, 21])).toEqual([
      ["Force Converter", 1, "one away"],
      ["Techsec Two", 1, "one away"],
    ])
  })
})
