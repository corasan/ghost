import { describe, expect, test } from "bun:test"
import type { ItemSlot } from "@ghost/contract"
import type { Inventory, OwnedItem } from "../bungie/inventory.ts"
import { type JudgeContext, judge, type Verdict } from "./judge.ts"
import type { RatedColumns, RatedPerk } from "./perks.ts"

const NOW = Date.parse("2026-10-06T12:00:00Z")

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 1,
  name: "Fatebringer",
  typeName: "Hand Cannon",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "solar",
  power: 550,
  quantity: 1,
  location: "vault",
  characterId: null,
  equipped: false,
  classType: null,
  locked: false,
  masterwork: false,
  statTotal: null,
  perks: [],
  duplicates: 0,
  decision: null,
  acquiredAt: null,
  armorStats: null,
  plugHashes: [],
  modSockets: [],
  weaponSockets: [],
  weaponStats: {},
  energy: null,
  exoticPerk: null,
  intrinsics: [],
  set: null,
  crafted: false,
  tuning: null,
  traits: [],
  ...fields,
})

const helmet = (id: string, total: number, fields: Partial<OwnedItem> = {}) =>
  owned(id, "helmet", {
    itemHash: 77,
    typeName: "Helmet",
    classType: "titan",
    damageType: "none",
    statTotal: total,
    armorStats: {
      mobility: 0,
      resilience: total - 20,
      recovery: 0,
      discipline: 12,
      intellect: 8,
      strength: 0,
    },
    ...fields,
  })

const inventory = (items: ReadonlyArray<OwnedItem>): Inventory => ({
  membershipType: 3,
  membershipId: "1",
  characters: [],
  items,
  vaultCount: items.length,
})

const context = (fields: Partial<JudgeContext> = {}): JudgeContext => ({
  builds: new Set(),
  loadouts: new Set(),
  rolls: new Map(),
  columns: new Map(),
  now: NOW,
  ...fields,
})

const run = (items: ReadonlyArray<OwnedItem>, ctx: JudgeContext = context()) =>
  judge(inventory(items), ctx)

const verdictOf = (verdicts: ReadonlyMap<string, Verdict>, id: string) => {
  const verdict = verdicts.get(id)
  if (verdict === undefined) throw new Error(`no verdict for ${id}`)
  return verdict
}

const pair = (fields: Partial<OwnedItem> = {}) => [
  owned("best", "kinetic", { power: 560 }),
  owned("worse", "kinetic", { power: 540, ...fields }),
]

const duplicateOf = (better: string, shared: ReadonlyArray<string> = []): Verdict => ({
  verdict: "junk",
  signals: [{ kind: "duplicate", better, shared }],
})

const GOOD = new Map<string, RatedPerk["good"]>([
  ["Demolitionist", ["pve"]],
  ["Rampage", ["pve"]],
  ["Tap the Trigger", ["pvp"]],
  ["Master of Arms", ["pvp"]],
])
const OK = new Set(["Outlaw", "Target Lock"])

/** Trait columns as the judge sees them: every option a column can slot, rated by GOOD and OK. */
const roll = (...columns: ReadonlyArray<ReadonlyArray<string>>): RatedColumns =>
  columns.map((column) =>
    column.map((name): RatedPerk => {
      const good = GOOD.get(name) ?? []
      const rating = good.length > 0 ? "good" : OK.has(name) ? "ok" : "junk"
      return { name, rating, good, source: rating === "junk" ? null : "player" }
    }),
  )

const rolled = (rolls: Readonly<Record<string, RatedColumns>>) =>
  context({ columns: new Map(Object.entries(rolls)) })

describe("judge", () => {
  test("keeps only the best of many copies and calls every other copy junk", () => {
    const hungers = Array.from({ length: 19 }, (_, i) =>
      owned(`gh${i}`, "kinetic", { name: "Gnawing Hunger", power: 501 + i }),
    )
    const verdicts = run(hungers)
    expect(verdictOf(verdicts, "gh18")).toEqual({ verdict: "keep", protections: ["best_copy"] })
    expect(hungers.slice(0, 18).map((item) => verdictOf(verdicts, item.itemInstanceId))).toEqual(
      Array(18).fill(duplicateOf("gh18")),
    )
  })

  test.each([
    ["locked", { locked: true }],
    ["masterworked", { masterwork: true }],
    ["equipped", { equipped: true, location: "character", characterId: "c1" }],
    ["crafted", { crafted: true }],
    ["marked_keep", { decision: "keep" }],
  ] as const)("never proposes a %s copy", (protection, fields) => {
    expect(verdictOf(run(pair(fields)), "worse")).toEqual({
      verdict: "keep",
      protections: [protection],
    })
  })

  test("never proposes a copy in a saved build or an in-game loadout", () => {
    const verdicts = run(
      pair(),
      context({ builds: new Set(["worse"]), loadouts: new Set(["worse"]) }),
    )
    expect(verdictOf(verdicts, "worse")).toEqual({
      verdict: "keep",
      protections: ["in_build", "in_loadout"],
    })
  })

  test("keeps the best PvE copy and the best PvP copy and calls the rest junk", () => {
    const verdicts = run(
      [
        owned("pve", "kinetic", { power: 510 }),
        owned("pvp", "kinetic", { power: 505 }),
        owned("half", "kinetic", { power: 532 }),
        owned("weak", "kinetic", { power: 520 }),
      ],
      rolled({
        pve: roll(["Demolitionist"], ["Rampage"]),
        pvp: roll(["Tap the Trigger"], ["Master of Arms"]),
        half: roll(["Demolitionist"], ["Target Lock"]),
        weak: roll(["Outlaw"], ["Kill Clip"]),
      }),
    )
    expect(verdictOf(verdicts, "pve")).toEqual({ verdict: "keep", protections: ["best_pve"] })
    expect(verdictOf(verdicts, "pvp")).toEqual({ verdict: "keep", protections: ["best_pvp"] })
    expect(verdictOf(verdicts, "half")).toEqual(duplicateOf("pve", ["Demolitionist"]))
    expect(verdictOf(verdicts, "weak")).toEqual({
      verdict: "junk",
      signals: [{ kind: "weak_roll", perks: ["Outlaw", "Kill Clip"] }],
    })
  })

  test("keeps a second copy for PvP when it is as good there as the copy kept for PvE", () => {
    const verdicts = run(
      [owned("both", "kinetic", { power: 540 }), owned("pvp", "kinetic", { power: 500 })],
      rolled({
        both: roll(["Demolitionist", "Tap the Trigger"], ["Rampage", "Master of Arms"]),
        pvp: roll(["Tap the Trigger"], ["Master of Arms"]),
      }),
    )
    expect(verdictOf(verdicts, "both")).toEqual({ verdict: "keep", protections: ["best_pve"] })
    expect(verdictOf(verdicts, "pvp")).toEqual({ verdict: "keep", protections: ["best_pvp"] })
  })

  test("one copy best at both stays as the only one when no other is as good for PvP", () => {
    const verdicts = run(
      [owned("both", "kinetic", { power: 540 }), owned("half", "kinetic", { power: 500 })],
      rolled({
        both: roll(["Demolitionist", "Tap the Trigger"], ["Rampage", "Master of Arms"]),
        half: roll(["Tap the Trigger"], ["Target Lock"]),
      }),
    )
    expect(verdictOf(verdicts, "both")).toEqual({
      verdict: "keep",
      protections: ["best_pve", "best_pvp"],
    })
    expect(verdictOf(verdicts, "half")).toEqual(duplicateOf("both", ["Tap the Trigger"]))
  })

  test("reviews, never junks, the best copy when no copy has a roll worth keeping", () => {
    const verdicts = run(
      [owned("high", "kinetic", { power: 560 }), owned("low", "kinetic", { power: 500 })],
      rolled({
        high: roll(["Outlaw"], ["Hip-Fire Grip"]),
        low: roll(["Moving Target"], ["Hip-Fire Grip"]),
      }),
    )
    expect(verdictOf(verdicts, "high")).toMatchObject({
      verdict: "review",
      why: "your best copy · no better copy",
    })
    expect(verdictOf(verdicts, "low").verdict).toBe("junk")
  })

  test("keeps the copy with the better wishlist score even when it has less power", () => {
    const rolls = new Map([
      ["roll", { wishlist: false, trash: false, score: 70 }],
      ["strong", { wishlist: false, trash: false, score: 40 }],
    ])
    const verdicts = run(
      [owned("strong", "kinetic", { power: 560 }), owned("roll", "kinetic", { power: 500 })],
      context({ rolls }),
    )
    expect(verdictOf(verdicts, "roll")).toEqual({ verdict: "keep", protections: ["best_copy"] })
    expect(verdictOf(verdicts, "strong")).toEqual(duplicateOf("roll"))
  })

  test("weighs a reissue with a new item hash against the copies of the weapon it replaced", () => {
    const verdicts = run([
      owned("old", "kinetic", { itemHash: 1, power: 560 }),
      owned("new", "kinetic", { itemHash: 2, power: 500, gearTier: 5 }),
    ])
    expect(verdictOf(verdicts, "old")).toEqual(duplicateOf("new"))
  })

  test("keeps a higher-tier copy over a lower one with the better roll", () => {
    const rolls = new Map([
      ["t4", { wishlist: false, trash: false, score: 80 }],
      ["t5", { wishlist: false, trash: false, score: 30 }],
    ])
    const verdicts = run(
      [owned("t4", "kinetic", { gearTier: 4 }), owned("t5", "kinetic", { gearTier: 5 })],
      context({ rolls }),
    )
    expect(verdictOf(verdicts, "t4")).toEqual(duplicateOf("t5"))
    expect(verdictOf(verdicts, "t5")).toEqual({ verdict: "keep", protections: ["best_copy"] })
  })

  test("reviews, never junks, a trash roll with no better copy", () => {
    const rolls = new Map([["only", { wishlist: false, trash: true, score: 10 }]])
    expect(verdictOf(run([owned("only", "energy")], context({ rolls })), "only")).toEqual({
      verdict: "review",
      signals: [{ kind: "trash_roll", score: 10 }],
      why: "your only copy · no better copy",
    })
  })

  test("leaves a lone weapon with nothing wrong out of the proposal", () => {
    expect(verdictOf(run([owned("only", "energy")]), "only")).toEqual({
      verdict: "keep",
      protections: ["only_copy"],
    })
  })

  test("reviews, never junks, a copy picked up in the last two days", () => {
    expect(verdictOf(run(pair({ acquiredAt: "2026-10-05T20:00:00Z" })), "worse")).toEqual({
      verdict: "review",
      signals: [{ kind: "duplicate", better: "best", shared: [] }],
      why: "picked up in the last two days",
    })
  })

  test("groups armor by role, so a weaker copy is judged against the best of its own role", () => {
    const verdicts = run([
      helmet("high", 68),
      helmet("low", 61),
      helmet("hunter", 50, { classType: "hunter" }),
      helmet("arms", 50, { slot: "arms" }),
    ])
    expect(verdictOf(verdicts, "low")).toEqual(duplicateOf("high"))
    expect(verdictOf(verdicts, "hunter").verdict).toBe("keep")
    expect(verdictOf(verdicts, "arms").verdict).toBe("keep")
  })

  test("calls tier 4 armor junk when a tier 5 copy fills the same role, whatever its tuning", () => {
    const verdicts = run([
      helmet("t4", 64, { gearTier: 4 }),
      helmet("t5", 66, { gearTier: 5, tuning: "recovery" }),
    ])
    expect(verdictOf(verdicts, "t4")).toEqual(duplicateOf("t5"))
    expect(verdictOf(verdicts, "t5")).toEqual({ verdict: "keep", protections: ["only_copy"] })
  })

  test("never weighs tier 5 armor tuned to different stats against each other", () => {
    const verdicts = run([
      helmet("high", 68, { gearTier: 5, tuning: "recovery" }),
      helmet("low", 61, { gearTier: 5, tuning: "mobility" }),
    ])
    expect(verdictOf(verdicts, "low")).toEqual({ verdict: "keep", protections: ["only_copy"] })
  })

  test("only reviews a tier 5 armor copy whose tuned stat could not be read", () => {
    const judged = (tuning: OwnedItem["tuning"]) =>
      verdictOf(
        run([
          helmet("high", 68, { gearTier: 5, tuning }),
          helmet("low", 61, { gearTier: 5, tuning }),
        ]),
        "low",
      )
    expect(judged(null)).toEqual({
      verdict: "review",
      signals: [{ kind: "duplicate", better: "high", shared: [] }],
      why: "its tuned stat could not be read",
    })
    expect(judged("recovery").verdict).toBe("junk")
  })

  test("never weighs exotic class items with different rolled perks against each other", () => {
    const spirits = (a: string, b: string) => ({
      tier: "exotic" as const,
      slot: "class" as const,
      intrinsics: ["Stoicism", a, b],
    })
    const verdicts = run([
      helmet("a", 75, spirits("Spirit of the Assassin", "Spirit of Inmost Light")),
      helmet("b", 75, spirits("Spirit of the Horn", "Spirit of Contact")),
    ])
    expect(verdictOf(verdicts, "b")).toEqual({ verdict: "keep", protections: ["only_copy"] })
  })

  test("keeps the best copy of each exotic armor piece", () => {
    const verdicts = run([helmet("a", 66, { tier: "exotic" }), helmet("b", 60, { tier: "exotic" })])
    expect(verdictOf(verdicts, "a")).toEqual({ verdict: "keep", protections: ["best_copy"] })
    expect(verdictOf(verdicts, "b")).toEqual(duplicateOf("a"))
  })
})
