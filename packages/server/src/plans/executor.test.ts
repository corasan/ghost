import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ItemSlot, LoadoutSaveTo, Plan, PlanRow } from "@ghost/contract"
import { Effect, Layer, Option, Redacted, type Result } from "effect"
import type { MigrationError } from "effect/sql/Migrator"
import type { SqlError } from "effect/sql/SqlError"
import { BungieClient, BungieError, type LoadoutSnapshot } from "../bungie/client.ts"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { type GameLoadouts, Loadouts } from "../bungie/loadouts.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { AppConfig } from "../config.ts"
import { ActionsRepo, ActionsRepoLive } from "../db/actions.ts"
import { BuildsRepo, BuildsRepoLive } from "../db/builds.ts"
import { DatabaseLive } from "../db/client.ts"
import { ItemsRepo, ItemsRepoLive } from "../db/items.ts"
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
  claudePath: "",
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
    Plans | JobsRepo | BuildsRepo | ActionsRepo | ItemsRepo,
    MigrationError | SqlError
  >
  readonly snapshots: Array<LoadoutSnapshot>
  readonly equips: Array<string>
  readonly transfers: Array<string>
}

const harness = (
  items: ReadonlyArray<OwnedItem>,
  refuseSnapshot?: string,
  game?: GameLoadouts,
): Harness => {
  const snapshots: Array<LoadoutSnapshot> = []
  const equips: Array<string> = []
  const transfers: Array<string> = []
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
    transferItem: (input) =>
      Effect.suspend(() => {
        const moving = inventory.items.find((i) => i.itemInstanceId === input.itemId)
        if (moving?.equipped === true) {
          return Effect.fail(new BungieError({ status: "Refused", message: "it is equipped" }))
        }
        transfers.push(`${input.itemId}:${input.transferToVault ? "vault" : "character"}`)
        inventory = {
          ...inventory,
          items: inventory.items.map((item) =>
            item.itemInstanceId !== input.itemId
              ? item
              : {
                  ...item,
                  location: input.transferToVault ? "vault" : "character",
                  characterId: input.transferToVault ? null : input.characterId,
                },
          ),
        }
        return Effect.void
      }),
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
    current: game === undefined ? unlinked : Effect.succeed(game),
    invalidate: Effect.void,
    catalog: unlinked,
  })
  const layer = PlansLive.pipe(
    Layer.provideMerge(Repos),
    Layer.provide(Layer.mergeAll(Bungie, Profile, LoadoutsStub)),
  )
  return { layer, snapshots, equips, transfers }
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

const noLoadouts: GameLoadouts = { byCharacter: new Map(), artifactHash: null }

// Items exist in items_seen once a profile load has synced them.
const seen = (items: ReadonlyArray<OwnedItem>) =>
  Effect.flatMap(ItemsRepo, (repo) => repo.sync(items))

const applyPlan = (
  items: ReadonlyArray<OwnedItem>,
  rows: ReadonlyArray<PlanRow>,
  kind: Plan["kind"] = "cleanup",
) =>
  Effect.gen(function* () {
    yield* seen(items)
    const jobs = yield* JobsRepo
    const created = yield* jobs.createManual({
      kind: "item_action",
      prompt: "Clean up",
      characterId: "titan-1",
      plan: new Plan({ ...plan(rows, ""), kind, saveTo: undefined }),
    })
    const plans = yield* Plans
    const applied = yield* plans.apply(
      created.id,
      rows.map((r) => r.itemInstanceId),
    )
    return { job: applied, actions: yield* (yield* ActionsRepo).forJobs([created.id]), plans }
  })

describe("apply a cleanup plan", () => {
  const vault = { location: "vault", characterId: null, equipped: false } as const

  test("tags junk but refuses an item the judge now protects", async () => {
    const junk = owned("junk", "kinetic", vault)
    const locked = owned("locked", "kinetic", { ...vault, locked: true })
    const masterworked = owned("mw", "energy", { ...vault, masterwork: true })
    const worn = owned("worn", "power")
    const crafted = owned("crafted", "energy", { ...vault, crafted: true })
    const keeper = owned("keeper", "energy", { ...vault, decision: "keep" })
    const built = owned("built", "kinetic", vault)
    const looped = owned("looped", "kinetic", vault)
    const all = [junk, locked, masterworked, worn, crafted, keeper, built, looped]
    const h = harness(all, undefined, {
      byCharacter: new Map([
        [
          "titan-1",
          [{ index: 0, nameHash: 1, colorHash: 1, iconHash: 1, itemInstanceIds: ["looped"] }],
        ],
      ]),
      artifactHash: null,
    })
    const rows = all.map((item) => row(item, "tag_junk"))
    const { job, actions } = await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* BuildsRepo).insert({
          jobId: crypto.randomUUID(),
          name: "Kinetic",
          recipe,
          plan: plan([row(built, "equip")], ""),
        })
        return yield* applyPlan(all, rows)
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
      ["crafted", "failed", "it is crafted, so it was not tagged junk"],
      ["keeper", "failed", "the player marked it keep, so it was not tagged junk"],
      ["built", "failed", "it is in a saved Ghost build, so it was not tagged junk"],
      ["looped", "failed", "it is in an in-game loadout, so it was not tagged junk"],
    ])
  })

  test("tags nothing when the in-game loadouts cannot be read", async () => {
    const junk = owned("junk", "kinetic", vault)
    const { job, actions } = await Effect.runPromise(
      applyPlan([junk], [row(junk, "tag_junk")]).pipe(Effect.provide(harness([junk]).layer)),
    )
    expect(actions).toEqual([])
    expect(job.plan?.rows[0]?.error).toBe(
      "your in-game loadouts could not be read, so it was not tagged junk",
    )
  })

  test("refuses to tag junk from a plan that is not a cleanup", async () => {
    const junk = owned("junk", "kinetic", vault)
    const { job, actions } = await Effect.runPromise(
      applyPlan([junk], [row(junk, "tag_junk")], "transfer").pipe(
        Effect.provide(harness([junk], undefined, noLoadouts).layer),
      ),
    )
    expect(actions).toEqual([])
    expect(job.plan?.rows[0]?.error).toBe("only a cleanup plan tags junk")
  })

  test("does not journal a tag for an item Ghost has never recorded", async () => {
    const junk = owned("unseen", "kinetic", vault)
    const h = harness([junk], undefined, noLoadouts)
    const { job, actions } = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* (yield* JobsRepo).createManual({
          kind: "item_action",
          prompt: "Clean up",
          characterId: "titan-1",
          plan: new Plan({
            ...plan([row(junk, "tag_junk")], ""),
            kind: "cleanup",
            saveTo: undefined,
          }),
        })
        const applied = yield* (yield* Plans).apply(created.id, ["unseen"])
        return { job: applied, actions: yield* (yield* ActionsRepo).forJobs([created.id]) }
      }).pipe(Effect.provide(h.layer)),
    )
    expect(actions).toEqual([])
    expect(job.plan?.rows[0]?.outcome).toBe("failed")
  })

  test("undo puts back the decision each item had before", async () => {
    const fresh = owned("fresh", "kinetic", vault)
    const again = owned("again", "energy", { ...vault, decision: "junk" })
    const h = harness([fresh, again], undefined, noLoadouts)
    const decisions = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* ItemsRepo
        yield* seen([fresh, again])
        yield* repo.setDecision("again", "junk")
        const { job, plans } = yield* applyPlan(
          [fresh, again],
          [row(fresh, "tag_junk"), row(again, "tag_junk")],
        )
        const undone = yield* plans.undo(job.id)
        const [a, b] = [yield* repo.get("fresh"), yield* repo.get("again")]
        return [undone.plan?.status, Option.getOrNull(a)?.decision, Option.getOrNull(b)?.decision]
      }).pipe(Effect.provide(h.layer)),
    )
    expect(decisions).toEqual(["undone", null, "junk"])
  })
})

describe("apply and undo run once", () => {
  test("a second apply while the first runs is refused, and every call is made once", async () => {
    const worn = owned("chest-old", "chest")
    const chest = owned("chest-new", "chest", { equipped: false })
    const h = harness([worn, chest])
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* (yield* JobsRepo).createManual({
          kind: "item_action",
          prompt: "Equip",
          characterId: "titan-1",
          plan: new Plan({ ...plan([row(chest, "equip")], ""), saveTo: undefined }),
        })
        const plans = yield* Plans
        const both = yield* Effect.all(
          [plans.apply(created.id, ["chest-new"]), plans.apply(created.id, ["chest-new"])].map(
            Effect.result,
          ),
          { concurrency: 2 },
        )
        const again = yield* Effect.result(plans.apply(created.id, ["chest-new"]))
        const undos = yield* Effect.all(
          [plans.undo(created.id), plans.undo(created.id)].map(Effect.result),
          { concurrency: 2 },
        )
        const redo = yield* Effect.result(plans.undo(created.id))
        return { both, again, undos, redo }
      }).pipe(Effect.provide(h.layer)),
    )
    const tags = (list: ReadonlyArray<Result.Result<unknown, { readonly _tag: string }>>) =>
      list.map((r) => (r._tag === "Success" ? "ok" : r.failure._tag))
    expect(tags(results.both)).toEqual(["ok", "PlanNotApplicable"])
    expect(tags([results.again])).toEqual(["PlanNotApplicable"])
    expect(tags(results.undos)).toEqual(["ok", "PlanNotApplicable"])
    expect(tags([results.redo])).toEqual(["PlanNotApplicable"])
    expect(h.equips).toEqual(["chest-new", "chest-old"])
  })
})

describe("undo what cannot be reversed", () => {
  test("an equip into an empty slot stays, keeps the item on the character, and the rest undoes", async () => {
    const helm = owned("helm", "helmet", {
      location: "vault",
      characterId: null,
      equipped: false,
    })
    const gloves = owned("gloves", "arms", { equipped: false })
    const h = harness([helm, gloves])
    const { undone, actions } = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* (yield* JobsRepo).createManual({
          kind: "item_action",
          prompt: "Equip",
          characterId: "titan-1",
          plan: new Plan({
            ...plan([row(helm, "equip"), row(gloves, "to_vault")], ""),
            saveTo: undefined,
          }),
        })
        const plans = yield* Plans
        yield* plans.apply(created.id, ["helm", "gloves"])
        const undone = yield* plans.undo(created.id)
        return { undone, actions: yield* (yield* ActionsRepo).forJobs([created.id]) }
      }).pipe(Effect.provide(h.layer)),
    )
    expect(undone.plan?.status).toBe("undone")
    expect(actions.map((a) => [a.itemInstanceId, a.kind, a.status])).toEqual([
      ["helm", "to_character", "ok"],
      ["helm", "equip", "ok"],
      ["gloves", "to_vault", "undone"],
    ])
    expect(h.transfers).toEqual(["helm:character", "gloves:vault", "gloves:character"])
  })
})

describe("apply exotics", () => {
  test("equips the piece that takes off the worn exotic before the new exotic", async () => {
    const wornExotic = owned("chest-exotic", "chest", { tier: "exotic" })
    const helm = owned("helm-old", "helmet")
    const newExotic = owned("helm-exotic", "helmet", { tier: "exotic", equipped: false })
    const chest = owned("chest-new", "chest", { equipped: false })
    const h = harness([wornExotic, helm, newExotic, chest])
    const job = await Effect.runPromise(
      Effect.gen(function* () {
        const created = yield* (yield* JobsRepo).createManual({
          kind: "item_action",
          prompt: "Equip",
          characterId: "titan-1",
          plan: new Plan({
            ...plan([row(newExotic, "equip"), row(chest, "equip")], ""),
            saveTo: undefined,
          }),
        })
        return yield* (yield* Plans).apply(created.id, ["helm-exotic", "chest-new"])
      }).pipe(Effect.provide(h.layer)),
    )
    expect(h.equips).toEqual(["chest-new", "helm-exotic"])
    expect(job.plan?.rows.map((r) => r.itemInstanceId)).toEqual(["helm-exotic", "chest-new"])
  })
})
