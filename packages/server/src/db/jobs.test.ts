import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Option, Redacted } from "effect"
import { AppConfig } from "../config.ts"
import type { BuildRecipe } from "../plans/recipe.ts"
import { DatabaseLive } from "./client.ts"
import { JobsRepo, JobsRepoLive } from "./jobs.ts"

const dataDir = mkdtempSync(join(tmpdir(), "ghost-jobs-"))
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

const JobsTest = JobsRepoLive.pipe(Layer.provideMerge(DatabaseLive), Layer.provide(ConfigTest))

const recipe: BuildRecipe = {
  kind: "build",
  title: "BUILD PLAN",
  subtitle: "Sentinel melee loop",
  confirmLabel: "APPLY BUILD",
  rows: [{ itemInstanceId: "helm", action: "equip", characterId: "titan" }],
  mods: [{ itemInstanceId: "helm", mod: "Hands-On", replaces: "Ashes to Assets" }],
  synergy: { exotic: "Feeds the loop.", mods: "More melee." },
  purpose: "Void Titan melee",
  subclass: { name: "Sentinel", fragments: ["Echo of Persistence"] },
  characterId: "titan",
}

test("a job keeps the recipe of its build and has none until one is set", async () => {
  const [before, after] = await Effect.gen(function* () {
    const jobs = yield* JobsRepo
    const job = yield* jobs.create({ kind: "build_suggestion", prompt: "a Titan melee build" })
    const before = yield* jobs.recipe(job.id)
    yield* jobs.setRecipe(job.id, recipe)
    return [before, yield* jobs.recipe(job.id)] as const
  }).pipe(Effect.provide(JobsTest), Effect.runPromise)
  expect(Option.isNone(before)).toBe(true)
  expect(Option.getOrNull(after)).toEqual(recipe)
})

test("a job carries no offer until Ghost makes one, then reads it back", async () => {
  const [before, after] = await Effect.gen(function* () {
    const jobs = yield* JobsRepo
    const job = yield* jobs.create({ kind: "chat", prompt: "Clean up my vault" })
    yield* jobs.setOffer(job.id, "cleanup_mode")
    return [job.offer, (yield* jobs.get(job.id)).offer] as const
  }).pipe(Effect.provide(JobsTest), Effect.runPromise)
  expect(before).toBeNull()
  expect(after).toBe("cleanup_mode")
})
