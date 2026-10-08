import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ArtifactPlan,
  type ItemSlot,
  LoadoutSaveTo,
  Plan,
  PlanRow,
  SubclassLoadout,
} from "@ghost/contract"
import { BungieError } from "../bungie/client.ts"
import { Effect, Layer, Redacted } from "effect"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { Loadouts } from "../bungie/loadouts.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { AppConfig } from "../config.ts"
import { BuildsRepoLive } from "../db/builds.ts"
import { ChargeEffects } from "../db/charge.ts"
import { Artifacts } from "../bungie/artifact.ts"
import { Wishlist } from "../wishlist/wishlist.ts"
import { DatabaseLive } from "../db/client.ts"
import { JobsRepo, JobsRepoLive } from "../db/jobs.ts"
import type { BuildRecipe } from "../plans/recipe.ts"
import {
  Builds,
  BuildsLive,
  buildFacets,
  buildReadiness,
  normalizePlan,
  substitute,
} from "./builds.ts"

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 100,
  name: `Item ${id}`,
  typeName: "Chest Armor",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "none",
  power: 550,
  quantity: 1,
  location: "vault",
  characterId: null,
  equipped: false,
  classType: "titan",
  locked: false,
  masterwork: false,
  statTotal: 60,
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
  traits: [],
  ...fields,
})

const row = (item: OwnedItem, action: PlanRow["action"] = "equip", fields: Partial<PlanRow> = {}) =>
  new PlanRow({
    itemInstanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: item.name,
    icon: null,
    tier: item.tier,
    meta: "",
    power: item.power,
    score: null,
    action,
    characterId: "titan-1",
    selected: true,
    outcome: "ok",
    error: null,
    slot: item.slot,
    typeName: item.typeName,
    ...fields,
  })

const loadout = new SubclassLoadout({
  classType: "titan",
  subclass: "Sentinel",
  element: "void",
  super: null,
  aspects: [],
  fragments: [],
})

const plan = (rows: ReadonlyArray<PlanRow>, fields: Partial<Plan> = {}) =>
  new Plan({
    kind: "build",
    title: "BUILD PLAN",
    subtitle: "Melee loop",
    stats: [],
    featured: null,
    rows,
    note: null,
    confirmLabel: "APPLY BUILD",
    status: "applied",
    loadout,
    ...fields,
  })

const titan: CharacterInfo = {
  characterId: "titan-1",
  classType: "titan",
  light: 550,
  subclass: "Sentinel",
  subclassIcon: null,
  ghostIcon: null,
  element: "void",
  loadout: { super: null, abilities: [], aspects: [], fragments: [] },
  subclasses: [],
  stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
  postmasterCount: 0,
}

const inventory = (items: ReadonlyArray<OwnedItem>): Inventory => ({
  membershipType: 3,
  membershipId: "m",
  characters: [titan],
  items,
  vaultCount: 0,
})

const bow = owned("bow", "kinetic", { typeName: "Combat Bow", tier: "exotic", name: "Le Monarque" })
const rifle = owned("rifle", "energy", { typeName: "Auto Rifle" })
const rocket = owned("rocket", "power", { typeName: "Rocket Launcher" })
const helm = owned("helm", "helmet", {
  typeName: "Helmet",
  tier: "exotic",
  name: "Loreley Splendor",
})
const chest = owned("chest", "chest")

describe("buildFacets", () => {
  test("reads class and element from the subclass and the exotics and weapon types from the rows", () => {
    const facets = buildFacets(
      plan([row(rocket), row(helm), row(bow, "none"), row(rifle), row(chest)]),
    )
    expect(facets?.classType).toBe("titan")
    expect(facets?.element).toBe("void")
    expect(facets?.subclass).toBe("Sentinel")
    expect(facets?.exoticArmor).toBe("Loreley Splendor")
    expect(facets?.exoticWeapon).toBe("Le Monarque")
    expect(facets?.weaponTypes).toEqual(["Combat Bow", "Auto Rifle", "Rocket Launcher"])
  })

  test("has nothing to say about a plan with no subclass", () => {
    expect(buildFacets(plan([row(helm)], { loadout: undefined }))).toBeUndefined()
  })
})

describe("buildReadiness", () => {
  const built = plan([row(helm), row(chest, "none")], {
    artifact: new ArtifactPlan({
      artifactHash: 1,
      name: "Old",
      picks: [],
      pointsAvailable: 12,
      reset: false,
    }),
  })
  const slot = {
    index: 2,
    nameHash: 0,
    colorHash: 0,
    iconHash: 0,
    itemInstanceIds: ["helm", "chest", "sub"],
  }

  test("names the pieces no longer owned and spots a past artifact", () => {
    const readiness = buildReadiness(built, inventory([chest]), null, undefined, 2)
    expect(readiness.missing).toEqual(["Loreley Splendor"])
    expect(readiness.pastArtifact).toBe(true)
    expect(readiness.inGame).toBeNull()
  })

  test("does not call the artifact past when Bungie did not say which is current", () => {
    expect(
      buildReadiness(built, inventory([helm, chest]), null, undefined, null).pastArtifact,
    ).toBe(false)
  })

  test("tells a matching slot from a changed one and from a cleared one", () => {
    const ref = { characterId: "titan-1", index: 2, savedAt: "now" }
    const inv = inventory([helm, chest])
    expect(buildReadiness(built, inv, ref, slot, null).inGame).toBe("matches")
    expect(
      buildReadiness(built, inv, ref, { ...slot, itemInstanceIds: ["helm", "other"] }, null).inGame,
    ).toBe("changed")
    expect(buildReadiness(built, inv, ref, { ...slot, itemInstanceIds: [] }, null).inGame).toBe(
      "cleared",
    )
    expect(buildReadiness(built, inv, ref, undefined, null).inGame).toBe("cleared")
  })
})

describe("substitute", () => {
  const recipe: BuildRecipe = {
    kind: "build",
    title: "BUILD PLAN",
    confirmLabel: "APPLY BUILD",
    rows: [
      { itemInstanceId: "helm", action: "equip" },
      { itemInstanceId: "chest", action: "equip" },
    ],
    mods: [{ itemInstanceId: "helm", mod: "Hands-On" }],
    featured: { itemInstanceId: "helm", perks: [], stats: [] },
    characterId: "titan-1",
  }
  const saved = plan([row(helm), row(chest)])

  test("swaps a lost piece for the best owned copy of the same item, mods and all", () => {
    const weak = owned("helm-2", "helmet", { itemHash: helm.itemHash, statTotal: 55 })
    const strong = owned("helm-3", "helmet", { itemHash: helm.itemHash, statTotal: 68 })
    const result = substitute(recipe, saved, inventory([weak, strong, chest]))
    expect(result.recipe.rows.map((r) => r.itemInstanceId)).toEqual(["helm-3", "chest"])
    expect(result.recipe.mods?.[0]?.itemInstanceId).toBe("helm-3")
    expect(result.recipe.featured?.itemInstanceId).toBe("helm-3")
    expect(result.substituted).toEqual(["Loreley Splendor"])
    expect(result.lost).toEqual([])
  })

  test("drops a piece with no copy left and hands back its row unticked", () => {
    const result = substitute(recipe, saved, inventory([chest]))
    expect(result.recipe.rows.map((r) => r.itemInstanceId)).toEqual(["chest"])
    expect(result.recipe.mods).toEqual([])
    expect(result.recipe.featured).toBeUndefined()
    expect(result.lost.map((r) => [r.name, r.selected, r.error])).toEqual([
      ["Loreley Splendor", false, "no longer owned"],
    ])
  })

  test("does not hand two rows the same copy", () => {
    const one = owned("chest-1", "chest", { itemHash: chest.itemHash })
    const twice: BuildRecipe = {
      ...recipe,
      rows: [
        { itemInstanceId: "chest", action: "equip" },
        { itemInstanceId: "chest-gone", action: "to_vault" },
      ],
    }
    const twiceSaved = plan([
      row(chest),
      row({ ...chest, itemInstanceId: "chest-gone" }, "to_vault"),
    ])
    const result = substitute(twice, twiceSaved, inventory([one]))
    expect(result.recipe.rows.map((r) => r.itemInstanceId)).toEqual(["chest-1"])
    expect(result.lost).toHaveLength(1)
  })
})

describe("normalizePlan", () => {
  test("forgets the first run: status, outcomes, errors and the slot it saved to", () => {
    const applied = plan([row(helm, "equip", { outcome: "failed", error: "nope" })], {
      saveTo: new LoadoutSaveTo({
        buildId: "b",
        characterId: "titan-1",
        index: 0,
        nameHash: 0,
        colorHash: 0,
        iconHash: 0,
        replaces: null,
        outcome: "ok",
        error: null,
      }),
    })
    const stored = normalizePlan(applied)
    expect(stored.status).toBe("proposed")
    expect(stored.saveTo).toBeUndefined()
    expect(stored.rows[0]?.outcome).toBeNull()
    expect(stored.rows[0]?.error).toBeNull()
  })
})

const dataDir = mkdtempSync(join(tmpdir(), "ghost-builds-service-"))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const ConfigTest = Layer.succeed(AppConfig, {
  host: "127.0.0.1",
  port: 0,
  dataDir,
  model: "test",
  effort: "low",
  claudePath: "",
  youtubeChannels: "",
  bungie: { apiKey: Redacted.make(""), clientId: "", clientSecret: Redacted.make("") },
  jev: { apiKey: Redacted.make(""), model: "test" },
})

const down = Effect.fail(new BungieError({ status: "Down", message: "Bungie is down" }))

const ServiceTest = BuildsLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(JobsRepoLive, BuildsRepoLive).pipe(
      Layer.provideMerge(DatabaseLive),
      Layer.provide(ConfigTest),
    ),
  ),
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(ProfileStore, { inventory: down, plugSets: down, invalidate: Effect.void }),
      Layer.succeed(Loadouts, { current: down, invalidate: Effect.void, catalog: down }),
      Layer.succeed(Manifest, {
        statFacts: Effect.succeed({}),
        plugFacts: () => Effect.succeed(new Map()),
        subclassPlugSets: () => Effect.succeed([]),
        armorMods: Effect.succeed([]),
        armorSets: Effect.succeed([]),
        tuningMods: Effect.succeed(new Map()),
        elementIcons: Effect.succeed({}),
        capacities: Effect.succeed({ vault: 700, postmaster: 21 }),
        ensure: Effect.void,
        lookup: () => Effect.succeed(new Map()),
        findByName: () => Effect.succeed([]),
      }),
      Layer.succeed(ChargeEffects, {
        forMods: () => Effect.succeed(new Map()),
        record: () => Effect.void,
      }),
      Layer.succeed(Artifacts, { forCharacter: () => Effect.succeed(null) }),
      Layer.succeed(Wishlist, {
        ensure: Effect.void,
        rollsFor: () => Effect.succeed(new Map()),
        recommended: Effect.succeed([]),
        asOf: Effect.succeed(null),
        source: Effect.die("unused"),
      }),
    ),
  ),
)

const recipe: BuildRecipe = {
  kind: "build",
  title: "BUILD PLAN",
  confirmLabel: "APPLY BUILD",
  rows: [{ itemInstanceId: "helm", action: "equip" }],
  characterId: "titan-1",
}

const buildJob = (withRecipe: boolean) =>
  Effect.gen(function* () {
    const jobs = yield* JobsRepo
    const job = yield* jobs.create({ kind: "build_suggestion", prompt: "a build" })
    yield* jobs.setPlan(job.id, plan([row(helm, "equip", { outcome: "failed", error: "x" })]))
    if (withRecipe) yield* jobs.setRecipe(job.id, recipe)
    return job.id
  })

describe("Builds.save", () => {
  test("saves once per job: a second save renames the same build, and Bungie being down only blanks readiness", async () => {
    const [first, second, all] = await Effect.gen(function* () {
      const builds = yield* Builds
      const jobId = yield* buildJob(true)
      const first = yield* builds.save({ jobId, name: "Melee" })
      const second = yield* builds.save({ jobId, name: "Melee v2" })
      return [first, second, yield* builds.list] as const
    }).pipe(Effect.provide(ServiceTest), Effect.runPromise)
    expect(second.build.id).toBe(first.build.id)
    expect(second.build.name).toBe("Melee v2")
    expect(first.confirm).toBeNull()
    expect(first.build.plan.status).toBe("proposed")
    expect(first.build.plan.rows[0]?.error).toBeNull()
    expect(first.build.readiness).toBeNull()
    expect(first.build.facets.subclass).toBe("Sentinel")
    expect(all.filter((b) => b.id === first.build.id)).toHaveLength(1)
  })

  test("refuses a build whose recipe was never kept", async () => {
    const result = await Effect.gen(function* () {
      const builds = yield* Builds
      const jobId = yield* buildJob(false)
      return yield* builds.save({ jobId, name: "Old" }).pipe(Effect.result)
    }).pipe(Effect.provide(ServiceTest), Effect.runPromise)
    expect(result._tag === "Failure" && result.failure._tag).toBe("PlanNotApplicable")
  })
})
