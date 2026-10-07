import { describe, expect, test } from "bun:test"
import {
  COMMUNITY,
  covers,
  keepable,
  type PerkKnowledge,
  type RatedPerk,
  ratePerk,
} from "./perks.ts"

const knowing = (fields: Partial<PerkKnowledge> = {}): PerkKnowledge => ({
  stored: new Map(),
  wishlisted: new Set(),
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
  test("a player's rating beats the wishlist, which beats the community count", () => {
    const known = knowing({
      stored: new Map([["rampage", { rating: "junk", source: "player" }]]),
      wishlisted: new Set(["rampage", "kill clip"]),
      community: new Map([["kill clip", COMMUNITY.good]]),
    })
    expect(ratePerk("Rampage", known)).toEqual({
      name: "Rampage",
      rating: "junk",
      source: "player",
    })
    expect(ratePerk("Enhanced Kill Clip", known)).toEqual({
      name: "Enhanced Kill Clip",
      rating: "good",
      source: "wishlist",
    })
  })

  test("a perk in this weapon's trash rolls is junk however popular elsewhere", () => {
    const known = knowing({
      trashed: new Set(["frenzy"]),
      community: new Map([["frenzy", COMMUNITY.good + 100]]),
    })
    expect(ratePerk("Frenzy", known).rating).toBe("junk")
  })

  test("rates by how many weapons the wishlist recommends a perk on", () => {
    const known = knowing({
      community: new Map([
        ["demolitionist", COMMUNITY.good],
        ["outlaw", COMMUNITY.ok],
        ["hip-fire grip", COMMUNITY.ok - 1],
      ]),
    })
    expect(["Demolitionist", "Outlaw", "Hip-Fire Grip"].map((n) => ratePerk(n, known))).toEqual([
      { name: "Demolitionist", rating: "good", source: "community" },
      { name: "Outlaw", rating: "ok", source: "community" },
      { name: "Hip-Fire Grip", rating: "junk", source: null },
    ])
  })

  test("a popular perk this weapon's own wishlist passes over is only ok", () => {
    const known = knowing({
      wishlisted: new Set(["kill clip"]),
      community: new Map([["demolitionist", COMMUNITY.good]]),
    })
    expect(ratePerk("Demolitionist", known).rating).toBe("ok")
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
  test("a copy that can slot every good and ok perk of another covers it, junk aside", () => {
    expect(covers(t5, [[perk("Kill Clip", "good")], [perk("Moving Target", "junk")]])).toBe(true)
  })

  test("a copy missing one of the other's good perks does not", () => {
    expect(covers(t5, [[perk("Kill Clip", "good")], [perk("Frenzy", "good")]])).toBe(false)
  })
})
