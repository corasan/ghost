import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ItemSlot } from "@ghost/contract"
import { Effect, Layer, Option, Redacted } from "effect"
import { BungieClient, BungieError, type TransferItemInput } from "../bungie/client.ts"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { AppConfig } from "../config.ts"
import { DatabaseLive } from "../db/client.ts"
import { ItemsRepo, ItemsRepoLive } from "../db/items.ts"
import { CleanupRepoLive } from "./repo.ts"
import { Cleanup, cleanupLayer } from "./service.ts"

const dirs: Array<string> = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const HUNTER = "hunter-1"
const TITAN = "titan-1"

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 100,
  name: `Item ${id}`,
  typeName: "Auto Rifle",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "kinetic",
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

const character = (characterId: string): CharacterInfo => ({
  characterId,
  classType: characterId === HUNTER ? "hunter" : "titan",
  light: 550,
  subclass: null,
  subclassIcon: null,
  ghostIcon: null,
  element: "void",
  loadout: { super: null, abilities: [], aspects: [], fragments: [] },
  subclasses: [],
  stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
  postmasterCount: 0,
})

const fail = (status: string) => Effect.fail(new BungieError({ status, message: status }))

/**
 * An account that behaves like Bungie's: a transfer to the vault must come
 * from the character holding the item, a transfer to a character must come
 * from the vault, and a bucket holds nine besides the equipped item.
 */
class Account {
  items: Array<OwnedItem>
  transfers: Array<TransferItemInput> = []
  refuse = new Map<string, string>()
  outageAfter = Number.POSITIVE_INFINITY
  stale: Inventory | null = null

  constructor(items: ReadonlyArray<OwnedItem>) {
    this.items = [...items]
  }

  get inventory(): Inventory {
    return {
      membershipType: 3,
      membershipId: "m",
      characters: [character(HUNTER), character(TITAN)],
      items: this.items,
      vaultCount: this.items.filter((i) => i.location === "vault").length,
    }
  }

  where(id: string) {
    return this.items.find((i) => i.itemInstanceId === id)
  }

  carried(characterId: string) {
    return this.items.filter(
      (i) => i.location === "character" && i.characterId === characterId && !i.equipped,
    )
  }

  delete(ids: ReadonlyArray<string>) {
    this.items = this.items.filter((i) => !ids.includes(i.itemInstanceId))
  }

  transfer(input: TransferItemInput) {
    if (this.transfers.length >= this.outageAfter) return fail("Transport")
    const refusal = this.refuse.get(input.itemId)
    if (refusal !== undefined) return fail(refusal)
    const item = this.where(input.itemId)
    if (item === undefined) return fail("DestinyItemNotFound")
    if (input.transferToVault) {
      if (item.location !== "character" || item.characterId !== input.characterId) {
        return fail("DestinyItemNotFound")
      }
      if (item.equipped) return fail("DestinyItemUniqueEquipRestricted")
    } else {
      if (item.location !== "vault") return fail("DestinyItemNotFound")
      const full = this.carried(input.characterId).filter((i) => i.slot === item.slot).length >= 9
      if (full) return fail("DestinyNoRoomInDestination")
    }
    this.transfers.push(input)
    this.items = this.items.map((i) =>
      i === item
        ? {
            ...i,
            location: input.transferToVault ? "vault" : "character",
            characterId: input.transferToVault ? null : input.characterId,
          }
        : i,
    )
    return Effect.void
  }
}

const harness = (account: Account, dataDir = mkdtempSync(join(tmpdir(), "ghost-cleanup-"))) => {
  dirs.push(dataDir)
  const unused = fail("NotInThisTest")
  const Config = Layer.succeed(AppConfig, {
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
  const Stubs = Layer.mergeAll(
    Layer.succeed(BungieClient, {
      isLinked: Effect.succeed(true),
      authorizeUrl: Effect.succeed(""),
      exchangeCode: () => unused,
      get: () => unused,
      transferItem: (input) => Effect.suspend(() => account.transfer(input)),
      pullFromPostmaster: () => unused,
      equipItem: () => unused,
      insertPlug: () => unused,
      snapshotLoadout: () => unused,
    }),
    Layer.succeed(ProfileStore, {
      inventory: Effect.sync(() => account.stale ?? account.inventory),
      plugSets: Effect.succeed({}),
      invalidate: Effect.void,
    }),
    Layer.succeed(Manifest, {
      statFacts: Effect.succeed({}),
      plugFacts: () => Effect.succeed(new Map()),
      subclassPlugSets: () => Effect.succeed([]),
      weaponPerkPools: () => Effect.succeed([]),
      plugInvestments: () => Effect.succeed(new Map()),
      armorMods: Effect.succeed([]),
      armorSets: Effect.succeed([]),
      tuningMods: Effect.succeed(new Map()),
      elementIcons: Effect.succeed({}),
      capacities: Effect.succeed({ vault: 600, postmaster: 21 }),
      ensure: Effect.void,
      lookup: () => Effect.succeed(new Map()),
      findByName: () => Effect.succeed([]),
    }),
  )
  const Repos = Layer.mergeAll(ItemsRepoLive, CleanupRepoLive).pipe(
    Layer.provideMerge(DatabaseLive),
    Layer.provide(Config),
  )
  const layer = cleanupLayer("0 millis").pipe(Layer.provideMerge(Repos), Layer.provide(Stubs))
  const run = <A, E>(program: Effect.Effect<A, E, Cleanup | ItemsRepo>) =>
    Effect.runPromise(program.pipe(Effect.provide(layer)))
  return { run, dataDir }
}

const kinetic = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => owned(`k${from + i}`, "kinetic", { decision: "junk" }))

const onHunter = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}) =>
  owned(id, slot, { location: "character", characterId: HUNTER, ...fields })

const tick = Effect.flatMap(Cleanup, (c) => c.tick)
const current = Effect.flatMap(Cleanup, (c) => c.current)
const begin = Effect.flatMap(Cleanup, (c) => c.start(HUNTER))
const refusal = Effect.flip(begin).pipe(
  Effect.map((e) => (e._tag === "CleanupRefused" ? e.reason : e._tag)),
)

describe("cleanup watcher", () => {
  test("stashes, delivers batch by batch as the player deletes, then returns the keepers", async () => {
    const account = new Account([
      onHunter("devils", "kinetic"),
      onHunter("chroma", "energy", { decision: "junk" }),
      onHunter("worn", "kinetic", { equipped: true }),
      owned("on-titan", "kinetic", {
        location: "character",
        characterId: TITAN,
        decision: "junk",
      }),
      ...kinetic(10),
    ])
    const { run } = harness(account)

    const first = await run(Effect.andThen(begin, Effect.andThen(tick, current)))
    expect(first?.stage).toBe("delivering")
    expect(first?.batch).toBe(0)
    expect(account.where("devils")?.location).toBe("vault")
    const handed = account.carried(HUNTER).map((i) => i.itemInstanceId)
    expect(handed).toHaveLength(10)
    expect(handed).toContain("chroma")
    expect(account.carried(HUNTER).filter((i) => i.slot === "kinetic")).toHaveLength(9)

    account.delete(handed)
    const second = await run(Effect.andThen(tick, current))
    expect(second?.batch).toBe(1)
    expect(second?.junk.filter((e) => e.state === "deleted")).toHaveLength(10)
    expect(
      account
        .carried(HUNTER)
        .map((i) => i.itemInstanceId)
        .sort(),
    ).toEqual(["k8", "k9"])

    account.delete(["k8", "k9"])
    const finished = await run(Effect.andThen(tick, current))
    expect(finished?.stage).toBe("finished")
    expect(finished?.junk.every((e) => e.state === "deleted")).toBe(true)

    const closed = await run(
      Effect.gen(function* () {
        const cleanup = yield* Cleanup
        if (finished === null) throw new Error("expected a session")
        yield* cleanup.command(finished.id, "return")
        yield* cleanup.tick
        return yield* cleanup.current
      }),
    )
    expect(closed).toBeNull()
    expect(account.where("devils")).toMatchObject({ location: "character", characterId: HUNTER })
    expect(
      account.transfers.filter((t) => t.itemId === "on-titan").map((t) => t.characterId),
    ).toEqual([TITAN, HUNTER])
  })

  test("keep sends the item back to the vault and drops its junk tag", async () => {
    const account = new Account(kinetic(3))
    const { run } = harness(account)
    const decision = await run(
      Effect.gen(function* () {
        const cleanup = yield* Cleanup
        const items = yield* ItemsRepo
        yield* items.sync(account.items)
        const session = yield* cleanup.start(HUNTER)
        yield* cleanup.tick
        const kept = yield* cleanup.keep(session.id, ["k1"])
        expect(kept.junk.find((e) => e.itemInstanceId === "k1")?.state).toBe("keeping")
        yield* cleanup.tick
        const after = yield* cleanup.current
        expect(after?.junk.map((e) => e.state)).toEqual(["in_hand", "kept", "in_hand"])
        return Option.getOrNull(yield* items.get("k1"))?.decision
      }),
    )
    expect(decision).toBe("keep")
    expect(account.where("k1")?.location).toBe("vault")
  })

  test("marking a batch deleted delivers the next one while the profile still shows it", async () => {
    const account = new Account(kinetic(10))
    const { run } = harness(account)
    const after = await run(
      Effect.gen(function* () {
        const cleanup = yield* Cleanup
        const session = yield* cleanup.start(HUNTER)
        yield* cleanup.tick
        const handed = account.carried(HUNTER).map((i) => i.itemInstanceId)
        const [first, ...rest] = handed
        if (first === undefined) throw new Error("expected a delivery")
        account.stale = account.inventory
        account.delete(handed)
        yield* cleanup.markDeleted(session.id, [first, ...rest])
        yield* cleanup.tick
        return yield* cleanup.current
      }),
    )
    expect(after?.batch).toBe(1)
    expect(account.carried(HUNTER).map((i) => i.itemInstanceId)).toEqual(["k9"])
  })

  test("skip returns the rest of the batch to the vault, still tagged junk", async () => {
    const account = new Account(kinetic(10))
    const { run } = harness(account)
    const skipped = await run(
      Effect.gen(function* () {
        const cleanup = yield* Cleanup
        const session = yield* cleanup.start(HUNTER)
        yield* cleanup.tick
        account.delete(["k0"])
        yield* cleanup.skip(session.id)
        yield* cleanup.tick
        return yield* cleanup.current
      }),
    )
    expect(skipped?.junk.filter((e) => e.batch === 0).map((e) => e.state)).toEqual([
      "deleted",
      ...Array(8).fill("skipped"),
    ])
    expect(skipped?.batch).toBe(1)
    expect(account.carried(HUNTER).map((i) => i.itemInstanceId)).toEqual(["k9"])
    expect(account.where("k1")).toMatchObject({ location: "vault", decision: "junk" })
  })

  test("finishing after deleting in game, before the profile catches up, counts the deletions", async () => {
    const account = new Account(kinetic(3))
    const { run } = harness(account)
    const finished = await run(
      Effect.gen(function* () {
        const cleanup = yield* Cleanup
        const session = yield* cleanup.start(HUNTER)
        yield* cleanup.tick
        const stale = account.inventory
        account.delete(["k0", "k1"])
        account.stale = stale
        yield* cleanup.skip(session.id)
        yield* cleanup.tick
        return yield* cleanup.current
      }),
    )
    expect(finished?.stage).toBe("finished")
    expect(finished?.junk.map((e) => e.state)).toEqual(["deleted", "deleted", "skipped"])
    expect(finished?.error).toBeNull()
  })

  test("a refused transfer fails that item only", async () => {
    const account = new Account(kinetic(3))
    account.refuse.set("k1", "DestinyItemNotFound")
    const { run } = harness(account)
    const session = await run(Effect.andThen(begin, Effect.andThen(tick, current)))
    expect(session?.junk.map((e) => e.state)).toEqual(["in_hand", "failed", "in_hand"])
    expect(session?.error).toBeNull()
  })

  test("an outage leaves moves pending, and a restarted server finishes them once", async () => {
    const account = new Account([
      onHunter("a", "kinetic"),
      onHunter("b", "energy"),
      onHunter("c", "power"),
      ...kinetic(2),
    ])
    account.outageAfter = 2
    const before = harness(account)
    const interrupted = await before.run(Effect.andThen(begin, Effect.andThen(tick, current)))
    expect(interrupted?.stage).toBe("stashing")
    expect(interrupted?.error).toBe("Transport")
    expect(interrupted?.stash.map((e) => e.state)).toEqual(["in_vault", "in_vault", "moving"])

    account.outageAfter = Number.POSITIVE_INFINITY
    const restarted = harness(account, before.dataDir)
    const resumed = await restarted.run(Effect.andThen(tick, current))
    expect(resumed?.stage).toBe("delivering")
    expect(resumed?.stash.every((e) => e.state === "in_vault")).toBe(true)
    expect(resumed?.error).toBeNull()
    expect(account.transfers.map((t) => t.itemId)).toEqual(["a", "b", "c", "k0", "k1"])
  })

  test("start refuses a stash the vault cannot hold, and a second session", async () => {
    const full = new Account([
      ...Array.from({ length: 599 }, (_, i) => owned(`v${i}`, "arms")),
      onHunter("a", "kinetic"),
      onHunter("b", "energy"),
      ...kinetic(1),
    ])
    const refused = await harness(full).run(refusal)
    expect(refused).toBe("The vault has room for 0 and the stash needs 2.")

    const { run } = harness(new Account(kinetic(1)))
    const again = await run(Effect.andThen(begin, refusal))
    expect(again).toBe("A cleanup is already running.")
  })
})
