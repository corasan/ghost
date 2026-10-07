import { describe, expect, test } from "bun:test"
import {
  COMMUNITY,
  goodColumns,
  keepable,
  type PerkKnowledge,
  type RatedPerk,
  ratePerk,
  WISHLIST_GOOD,
} from "./perks.ts"

const knowing = (fields: Partial<PerkKnowledge> = {}): PerkKnowledge => ({
  stored: new Map(),
  wishlisted: { pve: new Map(), pvp: new Map() },
  trashed: new Set(),
  community: new Map(),
  ...fields,
})

const NONE = { pve: 0, pvp: 0 }

const perk = (
  name: string,
  rating: RatedPerk["rating"],
  good: RatedPerk["good"] = [],
): RatedPerk => ({
  name,
  rating,
  good,
  source: rating === "junk" ? null : "community",
})

describe("ratePerk", () => {
  test("rates a perk per purpose, and a player's rating beats Claude's for the same purpose", () => {
    const known = knowing({
      stored: new Map([
        [
          "rampage",
          [
            { rating: "ok", source: "claude", purpose: "pve" },
            { rating: "good", source: "player", purpose: "pve" },
            { rating: "junk", source: "claude", purpose: "pvp" },
          ],
        ],
      ]),
    })
    expect(ratePerk("Rampage", known, NONE)).toEqual({
      name: "Rampage",
      rating: "good",
      good: ["pve"],
      source: "player",
    })
  })

  test("a perk rated for any purpose is good for PvE and PvP", () => {
    const known = knowing({
      stored: new Map([["kill clip", [{ rating: "good", source: "claude", purpose: "any" }]]]),
    })
    expect(ratePerk("Enhanced Kill Clip", known, NONE).good).toEqual(["pve", "pvp"])
  })

  test("a weapon with curated ratings leaves every perk the list skips at ok at best", () => {
    const known = knowing({
      stored: new Map([["demolitionist", [{ rating: "good", source: "claude", purpose: "pve" }]]]),
      wishlisted: { pve: new Map([["subsistence", 10]]), pvp: new Map() },
      community: new Map([["frenzy", COMMUNITY.good]]),
    })
    expect(
      ["Subsistence", "Frenzy"].map((n) => ratePerk(n, known, { pve: 10, pvp: 0 }).rating),
    ).toEqual(["ok", "ok"])
  })

  test("a perk in this weapon's trash rolls is junk however popular elsewhere", () => {
    const known = knowing({
      trashed: new Set(["frenzy"]),
      community: new Map([["frenzy", COMMUNITY.good + 100]]),
    })
    expect(ratePerk("Frenzy", known, NONE).rating).toBe("junk")
  })

  test("only the perks a purpose's wishlist rolls name most in a column are good for it", () => {
    const known = knowing({
      wishlisted: {
        pve: new Map([
          ["rampage", 10],
          ["kill clip", Math.ceil(10 * WISHLIST_GOOD)],
          ["multikill clip", Math.floor(10 * WISHLIST_GOOD) - 1],
        ]),
        pvp: new Map(),
      },
    })
    const tops = { pve: 10, pvp: 0 }
    expect(["Rampage", "Kill Clip", "Multikill Clip"].map((n) => ratePerk(n, known, tops))).toEqual(
      [
        { name: "Rampage", rating: "good", good: ["pve"], source: "wishlist" },
        { name: "Kill Clip", rating: "good", good: ["pve"], source: "wishlist" },
        { name: "Multikill Clip", rating: "ok", good: [], source: "wishlist" },
      ],
    )
  })

  test("rates a weapon the wishlist does not cover by how many weapons it recommends a perk on", () => {
    const known = knowing({
      community: new Map([
        ["demolitionist", COMMUNITY.good],
        ["outlaw", COMMUNITY.ok],
        ["hip-fire grip", COMMUNITY.ok - 1],
      ]),
    })
    expect(
      ["Demolitionist", "Outlaw", "Hip-Fire Grip"].map((n) => ratePerk(n, known, NONE).rating),
    ).toEqual(["good", "ok", "junk"])
  })
})

describe("keepable", () => {
  test("needs a good perk somewhere, or ok perks in both columns", () => {
    expect(keepable([[perk("A", "good", ["pve"])], [perk("B", "junk")]])).toBe(true)
    expect(keepable([[perk("A", "ok")], [perk("B", "ok")]])).toBe(true)
    expect(keepable([[perk("A", "ok")], [perk("B", "junk")]])).toBe(false)
  })
})

describe("goodColumns", () => {
  test("counts the columns that can slot a perk good for the purpose", () => {
    const columns = [
      [perk("Demolitionist", "good", ["pve"]), perk("Tap the Trigger", "good", ["pvp"])],
      [perk("Rampage", "good", ["pve"]), perk("Target Lock", "ok")],
    ]
    expect([goodColumns(columns, "pve"), goodColumns(columns, "pvp")]).toEqual([2, 1])
  })
})
