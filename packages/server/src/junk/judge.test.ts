import { describe, expect, test } from "bun:test"
import type { ItemSlot } from "@ghost/contract"
import { Effect } from "effect"
import { type Candidate, JevUnavailable, type JevService, type Subject } from "../agent/jev.ts"
import type { Inventory, OwnedItem } from "../bungie/inventory.ts"
import { type JudgeContext, judge, THRESHOLDS, type Verdict } from "./judge.ts"

const NOW = Date.parse("2026-10-06T12:00:00Z")

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 1,
  name: `Item ${id}`,
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
  energy: null,
  exoticPerk: null,
  intrinsics: [],
  set: null,
  crafted: false,
  tuning: null,
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
  purposes: [],
  rolls: new Map(),
  describe: (item) => `${item.name} ${item.power}`,
  now: NOW,
  ...fields,
})

interface Call {
  readonly intent: string
  readonly ids: ReadonlyArray<string>
  readonly subject: Subject
}

const stubJev = (answer: (subject: Subject, id: string) => number) => {
  const calls: Array<Call> = []
  const jev: JevService = {
    rank: (intent: string, candidates: ReadonlyArray<Candidate>, subject: Subject = "item") =>
      Effect.sync(() => {
        calls.push({ intent, ids: candidates.map((c) => c.id), subject })
        return new Map(candidates.map((c) => [c.id, answer(subject, c.id)]))
      }),
  }
  return { jev, calls }
}

const outclassedBy = (scores: Readonly<Record<string, number>>) =>
  stubJev((subject, id) => (subject === "outclassed" ? (scores[id] ?? 0) : 0))

const unavailable: JevService = {
  rank: () => Effect.fail(new JevUnavailable({ message: "down" })),
}

const run = (items: ReadonlyArray<OwnedItem>, ctx: JudgeContext, jev: JevService) =>
  Effect.runSync(judge(inventory(items), ctx, jev))

const verdictOf = (verdicts: ReadonlyMap<string, Verdict>, id: string) => {
  const verdict = verdicts.get(id)
  if (verdict === undefined) throw new Error(`no verdict for ${id}`)
  return verdict
}

const pair = (fields: Partial<OwnedItem> = {}) => [
  owned("best", "kinetic", { power: 560 }),
  owned("worse", "kinetic", { power: 540, ...fields }),
]

describe("judge", () => {
  test("calls a copy junk when a better copy outclasses it", () => {
    const { jev } = outclassedBy({ worse: 0.93 })
    const verdicts = run(pair(), context(), jev)
    expect(verdictOf(verdicts, "worse")).toEqual({
      verdict: "junk",
      signals: [{ kind: "duplicate", better: "best", outclassed: 0.93 }],
    })
    expect(verdictOf(verdicts, "best")).toEqual({ verdict: "keep", protections: ["best_copy"] })
  })

  test("asks Jev whether the better copy outclasses the others, once per group", () => {
    const { jev, calls } = outclassedBy({ worse: 0.93 })
    run(pair(), context(), jev)
    expect(calls).toEqual([{ intent: "Item best 560", ids: ["worse"], subject: "outclassed" }])
  })

  test.each([
    ["locked", { locked: true }],
    ["masterworked", { masterwork: true }],
    ["equipped", { equipped: true, location: "character", characterId: "c1" }],
    ["crafted", { crafted: true }],
    ["marked_keep", { decision: "keep" }],
  ] as const)("never proposes a %s copy, however outclassed", (protection, fields) => {
    const { jev } = outclassedBy({ worse: 0.99 })
    expect(verdictOf(run(pair(fields), context(), jev), "worse")).toEqual({
      verdict: "keep",
      protections: [protection],
    })
  })

  test("never proposes a copy in a saved build or an in-game loadout", () => {
    const { jev } = outclassedBy({ worse: 0.99 })
    const verdicts = run(
      pair(),
      context({ builds: new Set(["worse"]), loadouts: new Set(["worse"]) }),
      jev,
    )
    expect(verdictOf(verdicts, "worse")).toEqual({
      verdict: "keep",
      protections: ["in_build", "in_loadout"],
    })
  })

  test("never proposes a roll the wishlist recommends", () => {
    const { jev } = outclassedBy({ worse: 0.99 })
    const rolls = new Map([
      ["best", { wishlist: true, trash: false, score: 95 }],
      ["worse", { wishlist: true, trash: false, score: 85 }],
    ])
    expect(verdictOf(run(pair(), context({ rolls }), jev), "worse")).toEqual({
      verdict: "keep",
      protections: ["wishlist_roll"],
    })
  })

  test("keeps the copy with the better wishlist score even when it has less power", () => {
    const { jev } = outclassedBy({ strong: 0.99 })
    const rolls = new Map([
      ["roll", { wishlist: false, trash: false, score: 70 }],
      ["strong", { wishlist: false, trash: false, score: 40 }],
    ])
    const verdicts = run(
      [owned("strong", "kinetic", { power: 560 }), owned("roll", "kinetic", { power: 500 })],
      context({ rolls }),
      jev,
    )
    expect(verdictOf(verdicts, "roll")).toEqual({ verdict: "keep", protections: ["best_copy"] })
    expect(verdictOf(verdicts, "strong")).toEqual({
      verdict: "junk",
      signals: [{ kind: "duplicate", better: "roll", outclassed: 0.99 }],
    })
  })

  test("keeps the higher gear tier when the wishlist rates both rolls the same", () => {
    const { jev } = outclassedBy({ low: 0.99 })
    const verdicts = run(
      [
        owned("low", "kinetic", { power: 560, gearTier: 2 }),
        owned("high", "kinetic", { power: 500, gearTier: 5 }),
      ],
      context(),
      jev,
    )
    expect(verdictOf(verdicts, "high")).toEqual({ verdict: "keep", protections: ["best_copy"] })
  })

  test("only reviews a copy Jev rates just under the outclassed threshold", () => {
    const { jev } = outclassedBy({ worse: THRESHOLDS.outclassed - 0.01 })
    expect(verdictOf(run(pair(), context(), jev), "worse").verdict).toBe("review")
  })

  test("calls nothing junk while Jev is unavailable, and says so", () => {
    const verdict = verdictOf(run(pair(), context(), unavailable), "worse")
    expect(verdict.verdict).toBe("review")
    expect(verdict).toMatchObject({ why: expect.stringContaining("Jev was unavailable") })
  })

  test("calls nothing junk that Jev left unanswered", () => {
    const silent: JevService = { rank: () => Effect.succeed(new Map()) }
    expect(verdictOf(run(pair(), context(), silent), "worse").verdict).toBe("review")
  })

  test("reviews an outclassed copy that fits a saved build, naming the build", () => {
    const { jev } = stubJev((subject) => (subject === "outclassed" ? 0.95 : 0.8))
    const verdict = verdictOf(
      run(
        pair(),
        context({ purposes: [{ name: "Doom Fang shield loop", purpose: "Void Titan" }] }),
        jev,
      ),
      "worse",
    )
    expect(verdict.verdict).toBe("review")
    expect(verdict).toMatchObject({ why: expect.stringContaining("Doom Fang shield loop") })
  })

  test("lets a build that does not want the copy leave it junk", () => {
    const { jev } = stubJev((subject) =>
      subject === "outclassed" ? 0.95 : THRESHOLDS.purpose - 0.01,
    )
    const verdict = verdictOf(
      run(pair(), context({ purposes: [{ name: "Shield loop", purpose: "Void Titan" }] }), jev),
      "worse",
    )
    expect(verdict.verdict).toBe("junk")
  })

  test("reviews, never junks, a trash roll with no better copy", () => {
    const { jev } = outclassedBy({})
    const rolls = new Map([["only", { wishlist: false, trash: true, score: 10 }]])
    const verdict = verdictOf(run([owned("only", "energy")], context({ rolls }), jev), "only")
    expect(verdict).toMatchObject({
      verdict: "review",
      signals: [{ kind: "trash_roll", score: 10 }],
    })
  })

  test("leaves a lone weapon with nothing wrong out of the proposal", () => {
    const { jev } = outclassedBy({})
    expect(verdictOf(run([owned("only", "energy")], context(), jev), "only")).toEqual({
      verdict: "keep",
      protections: ["only_copy"],
    })
  })

  test("reviews, never junks, a copy picked up in the last two days", () => {
    const { jev } = outclassedBy({ worse: 0.99 })
    const verdict = verdictOf(
      run(pair({ acquiredAt: "2026-10-05T20:00:00Z" }), context(), jev),
      "worse",
    )
    expect(verdict).toMatchObject({
      verdict: "review",
      why: expect.stringContaining("last two days"),
    })
  })

  test("groups armor by role, so a weaker copy is judged against the best of its own role", () => {
    const { jev, calls } = outclassedBy({ low: 0.9 })
    const verdicts = run(
      [
        helmet("high", 68),
        helmet("low", 61),
        helmet("hunter", 50, { classType: "hunter" }),
        helmet("arms", 50, { slot: "arms" }),
      ],
      context(),
      jev,
    )
    expect(verdictOf(verdicts, "low")).toEqual({
      verdict: "junk",
      signals: [{ kind: "duplicate", better: "high", outclassed: 0.9 }],
    })
    expect(verdictOf(verdicts, "hunter").verdict).toBe("keep")
    expect(verdictOf(verdicts, "arms").verdict).toBe("keep")
    expect(calls.map((c) => c.ids)).toEqual([["low"]])
  })

  test("never weighs exotic class items with different rolled perks against each other", () => {
    const { jev, calls } = outclassedBy({ b: 0.99 })
    const spirits = (a: string, b: string) => ({
      tier: "exotic" as const,
      slot: "class" as const,
      intrinsics: ["Stoicism", a, b],
    })
    const verdicts = run(
      [
        helmet("a", 75, spirits("Spirit of the Assassin", "Spirit of Inmost Light")),
        helmet("b", 75, spirits("Spirit of the Horn", "Spirit of Contact")),
      ],
      context(),
      jev,
    )
    expect(verdictOf(verdicts, "b")).toEqual({ verdict: "keep", protections: ["only_copy"] })
    expect(calls).toEqual([])
  })

  test("keeps the best copy of each exotic armor piece", () => {
    const { jev } = outclassedBy({ b: 0.9 })
    const verdicts = run(
      [helmet("a", 66, { tier: "exotic" }), helmet("b", 60, { tier: "exotic" })],
      context(),
      jev,
    )
    expect(verdictOf(verdicts, "a")).toEqual({ verdict: "keep", protections: ["best_copy"] })
    expect(verdictOf(verdicts, "b").verdict).toBe("junk")
  })
})
