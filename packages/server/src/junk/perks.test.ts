import { describe, expect, test } from "bun:test"
import {
  COMMUNITY,
  covers,
  keepable,
  type PerkKnowledge,
  type RatedPerk,
  ratePerk,
  WISHLIST_GOOD,
} from "./perks.ts"

const knowing = (fields: Partial<PerkKnowledge> = {}): PerkKnowledge => ({
  stored: new Map(),
  wishlisted: new Map(),
  trashed: new Set(),
  community: new Map(),
  ...fields,
})

const perk = (name: string, rating: RatedPerk["rating"]): RatedPerk => ({
  name,
  rating,
  source: rating === "junk" ? null : "community",
})

describe("ratePerk", () => {
  test("a player's rating beats the wishlist and caps the perks it skips at ok", () => {
    const known = knowing({
      stored: new Map([["rampage", { rating: "junk", source: "player" }]]),
      wishlisted: new Map([
        ["rampage", 10],
        ["kill clip", 10],
      ]),
      community: new Map([["kill clip", COMMUNITY.good]]),
    })
    expect(ratePerk("Rampage", known, 10)).toEqual({
      name: "Rampage",
      rating: "junk",
      source: "player",
    })
    expect(ratePerk("Enhanced Kill Clip", known, 10)).toEqual({
      name: "Enhanced Kill Clip",
      rating: "ok",
      source: "wishlist",
    })
  })

  test("a perk in this weapon's trash rolls is junk however popular elsewhere", () => {
    const known = knowing({
      trashed: new Set(["frenzy"]),
      community: new Map([["frenzy", COMMUNITY.good + 100]]),
    })
    expect(ratePerk("Frenzy", known, 0).rating).toBe("junk")
  })

  test("rates by how many weapons the wishlist recommends a perk on", () => {
    const known = knowing({
      community: new Map([
        ["demolitionist", COMMUNITY.good],
        ["outlaw", COMMUNITY.ok],
        ["hip-fire grip", COMMUNITY.ok - 1],
      ]),
    })
    expect(["Demolitionist", "Outlaw", "Hip-Fire Grip"].map((n) => ratePerk(n, known, 0))).toEqual([
      { name: "Demolitionist", rating: "good", source: "community" },
      { name: "Outlaw", rating: "ok", source: "community" },
      { name: "Hip-Fire Grip", rating: "junk", source: null },
    ])
  })

  test("a popular perk this weapon's own wishlist passes over is only ok", () => {
    const known = knowing({
      wishlisted: new Map([["kill clip", 4]]),
      community: new Map([["demolitionist", COMMUNITY.good]]),
    })
    expect(ratePerk("Demolitionist", known, 4).rating).toBe("ok")
  })

  test("only the perks this weapon's wishlist names most in a column are good", () => {
    const known = knowing({
      wishlisted: new Map([
        ["rampage", 10],
        ["kill clip", Math.ceil(10 * WISHLIST_GOOD)],
        ["multikill clip", Math.floor(10 * WISHLIST_GOOD) - 1],
      ]),
    })
    expect(
      ["Rampage", "Kill Clip", "Multikill Clip"].map((n) => ratePerk(n, known, 10).rating),
    ).toEqual(["good", "good", "ok"])
  })

  test("a weapon with curated ratings leaves every perk the list skips at ok at best", () => {
    const known = knowing({
      stored: new Map([["demolitionist", { rating: "good", source: "claude" }]]),
      wishlisted: new Map([["subsistence", 10]]),
      community: new Map([["rampage", COMMUNITY.good]]),
    })
    expect(
      ["Demolitionist", "Subsistence", "Rampage"].map((n) => ratePerk(n, known, 10).rating),
    ).toEqual(["good", "ok", "ok"])
  })
})

describe("keepable", () => {
  test("needs a good perk somewhere, or ok perks in both columns", () => {
    expect(keepable([[perk("A", "good")], [perk("B", "junk")]])).toBe(true)
    expect(keepable([[perk("A", "ok")], [perk("B", "ok")]])).toBe(true)
    expect(keepable([[perk("A", "ok")], [perk("B", "junk")]])).toBe(false)
  })
})

describe("covers", () => {
  const t5 = [
    [perk("Kill Clip", "good"), perk("Outlaw", "ok")],
    [perk("Rampage", "good"), perk("Hip-Fire Grip", "junk")],
  ]
  test("a copy that can slot every good perk of another covers it, ok and junk aside", () => {
    expect(covers(t5, [[perk("Kill Clip", "good")], [perk("Feeding Frenzy", "ok")]])).toBe(true)
  })

  test("a copy missing one of the other's good perks does not", () => {
    expect(covers(t5, [[perk("Kill Clip", "good")], [perk("Frenzy", "good")]])).toBe(false)
  })
})
