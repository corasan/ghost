import { describe, expect, test } from "bun:test"
import type { ManifestItem } from "../bungie/manifest.ts"
import { rollLines } from "./text.ts"

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
