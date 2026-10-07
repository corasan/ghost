import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Redacted } from "effect"
import type { Candidate, JevService, Subject } from "../agent/jev.ts"
import type { Inventory, OwnedItem } from "../bungie/inventory.ts"
import { AppConfig } from "../config.ts"
import { DatabaseLive } from "../db/client.ts"
import { cachedJev, JevAnswers, JevAnswersLive } from "./cache.ts"
import { judge } from "./judge.ts"

const dataDir = mkdtempSync(join(tmpdir(), "ghost-jev-cache-"))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const ConfigTest = Layer.succeed(AppConfig, {
  host: "127.0.0.1",
  port: 0,
  dataDir,
  model: "test",
  effort: "low",
  youtubeChannels: "",
  bungie: { apiKey: Redacted.make(""), clientId: "", clientSecret: Redacted.make("") },
  jev: { apiKey: Redacted.make(""), model: "test" },
})

const AnswersTest = JevAnswersLive.pipe(Layer.provideMerge(DatabaseLive), Layer.provide(ConfigTest))

const weapon = (id: string, power: number): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 9,
  name: "Fatebringer",
  typeName: "Hand Cannon",
  icon: null,
  tier: "legendary",
  slot: "kinetic",
  damageType: "kinetic",
  power,
  quantity: 1,
  location: "vault",
  characterId: null,
  equipped: false,
  classType: null,
  locked: false,
  masterwork: false,
  statTotal: null,
  perks: [],
  duplicates: 1,
  decision: null,
  acquiredAt: null,
  armorStats: null,
  plugHashes: [],
  modSockets: [],
  energy: null,
  exoticPerk: null,
  set: null,
  crafted: false,
})

const inv: Inventory = {
  membershipType: 3,
  membershipId: "1",
  characters: [],
  items: [weapon("a", 560), weapon("b", 540), weapon("c", 530)],
  vaultCount: 3,
}

const counting = (answer: (subject: Subject) => number) => {
  let calls = 0
  const jev: JevService = {
    rank: (_intent: string, candidates: ReadonlyArray<Candidate>, subject: Subject = "item") =>
      Effect.sync(() => {
        calls += 1
        return new Map(candidates.map((c) => [c.id, answer(subject)]))
      }),
  }
  return { jev, calls: () => calls }
}

const context = {
  builds: new Set<string>(),
  loadouts: new Set<string>(),
  purposes: [{ name: "Shield loop", purpose: "Void Titan" }],
  rolls: new Map(),
  describe: (item: OwnedItem) => `${item.name} ${item.itemInstanceId}`,
  now: 0,
}

describe("cachedJev", () => {
  test("judges the same vault again without asking Jev, and reaches the same verdicts", async () => {
    const { first, second, calls } = await Effect.runPromise(
      Effect.gen(function* () {
        const answers = yield* JevAnswers
        const live = counting((subject) => (subject === "outclassed" ? 0.91 : 0.1))
        const first = yield* judge(inv, context, cachedJev(live.jev, answers, "jev-1"))
        const before = live.calls()
        const second = yield* judge(inv, context, cachedJev(live.jev, answers, "jev-1"))
        return { first, second, calls: live.calls() - before }
      }).pipe(Effect.provide(AnswersTest)),
    )
    expect(calls).toBe(0)
    expect([...second]).toEqual([...first])
    expect(first.get("b")?.verdict).toBe("junk")
  })

  test("never answers one question with what Jev said about another", async () => {
    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const answers = yield* JevAnswers
        const candidates = [{ id: "x", text: "Fatebringer x" }]
        const ask = (model: string, subject: Subject, value: number) =>
          cachedJev(counting(() => value).jev, answers, model).rank("intent", candidates, subject)
        return [
          yield* ask("jev-2", "outclassed", 0.9),
          yield* ask("jev-2", "item", 0.2),
          yield* ask("jev-3", "outclassed", 0.4),
          yield* ask("jev-2", "outclassed", 0.0),
        ].map((map) => map.get("x"))
      }).pipe(Effect.provide(AnswersTest)),
    )
    expect(answered).toEqual([0.9, 0.2, 0.4, 0.9])
  })
})
