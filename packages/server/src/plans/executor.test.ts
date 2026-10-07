import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ItemSlot, LoadoutSaveTo, Plan, PlanRow } from "@ghost/contract"
import { Effect, Layer, Redacted } from "effect"
import type { MigrationError } from "effect/sql/Migrator"
import type { SqlError } from "effect/sql/SqlError"
import { BungieClient, BungieError, type LoadoutSnapshot } from "../bungie/client.ts"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { Loadouts } from "../bungie/loadouts.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { AppConfig } from "../config.ts"
import { ActionsRepo, ActionsRepoLive } from "../db/actions.ts"
import { BuildsRepo, BuildsRepoLive } from "../db/builds.ts"
import { DatabaseLive } from "../db/client.ts"
import { ItemsRepoLive } from "../db/items.ts"
import { JobsRepo, JobsRepoLive } from "../db/jobs.ts"
import { Plans, PlansLive } from "./executor.ts"
import type { BuildRecipe } from "./recipe.ts"

const dataDir = mkdtempSync(join(tmpdir(), "ghost-executor-"))
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

const Repos = Layer.mergeAll(JobsRepoLive, ItemsRepoLive, ActionsRepoLive, BuildsRepoLive).pipe(
  Layer.provideMerge(DatabaseLive),
  Layer.provide(ConfigTest),
)

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 100,
  name: `Item ${id}`,
  typeName: "Armor",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "none",
  power: 550,
  quantity: 1,
  location: "character",
  characterId: "titan-1",
  equipped: true,
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
  set: null,
  crafted: false,
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

const row = (item: OwnedItem, action: PlanRow["action"]) =>
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
    outcome: null,
    error: null,
  })

const recipe: BuildRecipe = {
  kind: "build",
  title: "BUILD PLAN",
  confirmLabel: "APPLY BUILD",
  rows: [],
  characterId: "titan-1",
}

interface Harness {
  readonly layer: Layer.Layer<
    Plans | JobsRepo | BuildsRepo | ActionsRepo,
    MigrationError | SqlError
  >
  readonly snapshots: Array<LoadoutSnapshot>
  readonly equips: Array<string>
}

const harness = (items: ReadonlyArray<OwnedItem>, refuseSnapshot?: string): Harness => {
  const snapshots: Array<LoadoutSnapshot> = []
  const equips: Array<string> = []
  let inventory: Inventory = {
    membershipType: 3,
    membershipId: "m",
    characters: [titan],
    items,
    vaultCount: 0,
  }
  const unlinked = Effect.fail(new BungieError({ status: "Test", message: "not in this test" }))
  const Bungie = Layer.succeed(BungieClient, {
    isLinked: Effect.succeed(true),
    authorizeUrl: Effect.succeed(""),
    exchangeCode: () => unlinked,
    get: () => unlinked,
    transferItem: () => unlinked,
    pullFromPostmaster: () => unlinked,
    equipItem: (input) =>
      Effect.sync(() => {
        equips.push(input.itemId)
        const slot = inventory.items.find((i) => i.itemInstanceId === input.itemId)?.slot
        inventory = {
          ...inventory,
          items: inventory.items.map((item) =>
            item.slot !== slot ? item : { ...item, equipped: item.itemInstanceId === input.itemId },
          ),
        }
      }),
    insertPlug: () => unlinked,
    snapshotLoadout: (input) =>
      Effect.suspend(() => {
        snapshots.push(input)
        return refuseSnapshot === undefined
          ? Effect.void
          : Effect.fail(new BungieError({ status: "Refused", message: refuseSnapshot }))
      }),
  })
  const Profile = Layer.succeed(ProfileStore, {
    inventory: Effect.sync(() => inventory),
    plugSets: Effect.succeed({}),
    invalidate: Effect.void,
  })
  const LoadoutsStub = Layer.succeed(Loadouts, {
    current: unlinked,
    invalidate: Effect.void,
    catalog: unlinked,
  })
  const layer = PlansLive.pipe(
    Layer.provideMerge(Repos),
    Layer.provide(Layer.mergeAll(Bungie, Profile, LoadoutsStub)),
  )
  return { layer, snapshots, equips }
}

const saveTo = (buildId: string) =>
  new LoadoutSaveTo({
    buildId,
    characterId: "titan-1",
    index: 3,
    nameHash: 752612103,
    colorHash: 3871954967,
    iconHash: 1143786716,
    replaces: "Raid",
    outcome: null,
    error: null,
  })

const plan = (rows: ReadonlyArray<PlanRow>, buildId: string) =>
  new Plan({
    kind: "build",
    title: "BUILD PLAN",
    subtitle: null,
    stats: [],
    featured: null,
    rows,
    note: null,
    confirmLabel: "EQUIP & SAVE",
    status: "proposed",
    saveTo: saveTo(buildId),
  })

const applyBuild = (rows: ReadonlyArray<PlanRow>) =>
  Effect.gen(function* () {
    const builds = yield* BuildsRepo
    const jobs = yield* JobsRepo
    const plans = yield* Plans
    const build = yield* builds.insert({
      jobId: crypto.randomUUID(),
      name: "Melee",
      recipe,
      plan: plan([], ""),
    })
    const job = yield* jobs.createManual({
      kind: "saved_build",
      prompt: "Equip Melee",
      characterId: "titan-1",
      plan: plan(rows, build.id),
    })
    const applied = yield* plans.apply(
      job.id,
      rows.map((r) => r.itemInstanceId),
    )
    const actions = yield* (yield* ActionsRepo).forJobs([job.id])
    return { build: yield* builds.get(build.id), job: applied, actions, plans }
  })

describe("apply with saveTo", () => {
  const helm = owned("helm", "helmet")
  const wornChest = owned("chest-old", "chest")
  const chest = owned("chest-new", "chest", { equipped: false })

  test("snapshots the slot once every piece is on, journals it, and marks the build in game", async () => {
    const h = harness([helm, wornChest, chest])
    const { build, job, actions } = await Effect.runPromise(
      applyBuild([row(helm, "none"), row(chest, "equip")]).pipe(Effect.provide(h.layer)),
    )
    expect(h.equips).toEqual(["chest-new"])
    expect(h.snapshots).toEqual([
      {
        loadoutIndex: 3,
        characterId: "titan-1",
        membershipType: 3,
        nameHash: 752612103,
        colorHash: 3871954967,
        iconHash: 1143786716,
      },
    ])
    expect(job.plan?.saveTo?.outcome).toBe("ok")
    expect(job.plan?.status).toBe("applied")
    expect(build.inGame?.index).toBe(3)
    expect(actions.map((a) => [a.kind, a.status])).toEqual([
      ["equip", "ok"],
      ["snapshot_loadout", "ok"],
    ])
  })

  test("skips the snapshot and names the drift when a kept piece is not on the character", async () => {
    const h = harness([
      helm,
      wornChest,
      owned("chest-vault", "chest", { location: "vault", characterId: null, equipped: false }),
    ])
    const { build, job } = await Effect.runPromise(
      applyBuild([row(helm, "none"), row(owned("chest-vault", "chest"), "none")]).pipe(
        Effect.provide(h.layer),
      ),
    )
    expect(h.snapshots).toEqual([])
    expect(job.plan?.saveTo?.outcome).toBe("skipped")
    expect(job.plan?.saveTo?.error).toBe("not saved in game: Item chest-vault is not equipped")
    expect(build.inGame).toBeNull()
  })

  test("reports Bungie's refusal and leaves the build unmarked", async () => {
    const h = harness([helm, wornChest, chest], "Cannot snapshot while in an activity")
    const { build, job, actions } = await Effect.runPromise(
      applyBuild([row(chest, "equip")]).pipe(Effect.provide(h.layer)),
    )
    expect(job.plan?.saveTo?.outcome).toBe("failed")
    expect(job.plan?.saveTo?.error).toBe("Cannot snapshot while in an activity")
    expect(build.inGame).toBeNull()
    expect(actions.find((a) => a.kind === "snapshot_loadout")?.status).toBe("failed")
  })

  test("undo puts the gear back but keeps the in-game slot and says so", async () => {
    const h = harness([helm, wornChest, chest])
    const undone = await Effect.runPromise(
      applyBuild([row(chest, "equip")]).pipe(
        Effect.flatMap(({ job, plans }) => plans.undo(job.id)),
        Effect.provide(h.layer),
      ),
    )
    expect(h.equips).toEqual(["chest-new", "chest-old"])
    expect(h.snapshots).toHaveLength(1)
    expect(undone.plan?.status).toBe("undone")
    expect(undone.plan?.saveTo?.outcome).toBe("ok")
    expect(undone.plan?.saveTo?.error).toBe("The in-game slot was kept.")
  })
})

describe("apply a cleanup plan", () => {
  test("tags junk but refuses an item that was locked, masterworked or equipped since it was proposed", async () => {
    const vault = { location: "vault", characterId: null, equipped: false } as const
    const junk = owned("junk", "kinetic", vault)
    const locked = owned("locked", "kinetic", { ...vault, locked: true })
    const masterworked = owned("mw", "energy", { ...vault, masterwork: true })
    const worn = owned("worn", "power")
    const h = harness([junk, locked, masterworked, worn])
    const rows = [junk, locked, masterworked, worn].map((item) => row(item, "tag_junk"))
    const { job, actions } = await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* JobsRepo
        const created = yield* jobs.createManual({
          kind: "item_action",
          prompt: "Clean up",
          characterId: "titan-1",
          plan: new Plan({ ...plan(rows, ""), kind: "cleanup", saveTo: undefined }),
        })
        const applied = yield* (yield* Plans).apply(
          created.id,
          rows.map((r) => r.itemInstanceId),
        )
        return { job: applied, actions: yield* (yield* ActionsRepo).forJobs([created.id]) }
      }).pipe(Effect.provide(h.layer)),
    )
    expect(actions.map((a) => [a.itemInstanceId, a.kind, a.status])).toEqual([
      ["junk", "tag_junk", "ok"],
    ])
    expect(job.plan?.rows.map((r) => [r.itemInstanceId, r.outcome, r.error])).toEqual([
      ["junk", "ok", null],
      ["locked", "failed", "it is locked, so it was not tagged junk"],
      ["mw", "failed", "it is masterworked, so it was not tagged junk"],
      ["worn", "failed", "it is equipped, so it was not tagged junk"],
    ])
  })
})
