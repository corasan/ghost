import { describe, expect, test } from "bun:test"
import type { ArmorSet } from "./manifest.ts"
import { setBonusesFor } from "./sets.ts"

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

const active = (itemHashes: ReadonlyArray<number>) =>
  setBonusesFor([techsec, aion], itemHashes).map((bonus) => [bonus.name, bonus.set, bonus.worn])

describe("setBonusesFor", () => {
  test("a bonus turns on at exactly the pieces it needs, not one fewer", () => {
    expect(active([11, 31, 32, 33, 34])).toEqual([])
    expect(active([11, 12, 31, 32, 33])).toEqual([["Techsec Two", "Techsec", 2]])
    expect(active([11, 12, 13, 31, 32])).toEqual([["Techsec Two", "Techsec", 3]])
    expect(active([11, 12, 13, 14, 31])).toEqual([
      ["Techsec Two", "Techsec", 4],
      ["Techsec Four", "Techsec", 4],
    ])
  })

  test("each set counts only its own pieces", () => {
    expect(active([11, 12, 21, 22, 23])).toEqual([
      ["Force Converter", "AION Renewal", 3],
      ["Techsec Two", "Techsec", 2],
    ])
  })

  test("the same piece listed twice counts once", () => {
    expect(active([11, 11, 21, 21, 21, 21])).toEqual([])
  })
})
