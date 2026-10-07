import { describe, expect, test } from "bun:test"
import type { CleanupSession, GearSlot, ItemSlot } from "@ghost/contract"
import { Result } from "effect"
import type { Inventory, OwnedItem } from "../bungie/inventory.ts"
import { begin, command, keep, nextMoves, plan, reconcile, settle, skip, start } from "./engine.ts"

const HUNTER = "hunter-1"
const NOW = "2026-10-06T12:00:00.000Z"
const LATER = "2026-10-06T12:41:00.000Z"

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
  energy: null,
  exoticPerk: null,
  intrinsics: [],
  set: null,
  crafted: false,
  tuning: null,
  traits: [],
  ...fields,
})

const inventory = (items: ReadonlyArray<OwnedItem>, vaultCount = 559): Inventory => ({
  membershipType: 3,
  membershipId: "m",
  characters: [],
  items,
  vaultCount,
})

const DESIGN_COUNTS: ReadonlyArray<readonly [GearSlot, number]> = [
  ["kinetic", 31],
  ["energy", 24],
  ["power", 12],
  ["helmet", 16],
  ["arms", 11],
  ["chest", 9],
  ["legs", 10],
  ["class", 5],
]

const vaultJunk = (counts: ReadonlyArray<readonly [GearSlot, number]>) =>
  counts.flatMap(([slot, n]) =>
    Array.from({ length: n }, (_, i) => owned(`${slot}-${i}`, slot, { decision: "junk" })),
  )

const carried = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}) =>
  owned(id, slot, { location: "character", characterId: HUNTER, ...fields })

const session = (inv: Inventory, capacity = 600): CleanupSession =>
  start(plan(inv, HUNTER, capacity), "s1", NOW)

const remove = (inv: Inventory, ids: ReadonlyArray<string>): Inventory => ({
  ...inv,
  items: inv.items.filter((i) => !ids.includes(i.itemInstanceId)),
})

const place = (inv: Inventory, ids: ReadonlyArray<string>, onCharacter: boolean): Inventory => ({
  ...inv,
  items: inv.items.map((i) =>
    ids.includes(i.itemInstanceId)
      ? {
          ...i,
          location: onCharacter ? "character" : "vault",
          characterId: onCharacter ? HUNTER : null,
        }
      : i,
  ),
})

const runMoves = (s: CleanupSession) =>
  nextMoves(s).reduce((acc, move) => settle(begin(acc, move), move, "landed", NOW), s)

const batchIds = (s: CleanupSession, batch: number) =>
  s.junk.filter((e) => e.batch === batch).map((e) => e.itemInstanceId)

const sizes = (s: CleanupSession) =>
  Array.from({ length: s.batches }, (_, b) => s.junk.filter((e) => e.batch === b).length)

describe("plan", () => {
  test("fills every slot to nine per batch, reproducing the design's 118 items in 4 batches", () => {
    const planned = plan(inventory(vaultJunk(DESIGN_COUNTS)), HUNTER, 600)
    expect(planned.preview.junk).toBe(118)
    expect(planned.preview.batches).toBe(4)
    const s = start(planned, "s1", NOW)
    expect(sizes(s)).toEqual([68, 31, 15, 4])
    expect(s.junk.filter((e) => e.slot === "kinetic").map((e) => e.batch)).toEqual([
      ...Array(9).fill(0),
      ...Array(9).fill(1),
      ...Array(9).fill(2),
      ...Array(4).fill(3),
    ])
  })

  test("stashes what the character carries, returns only its non-junk, and skips equipped junk", () => {
    const inv = inventory([
      carried("devils", "kinetic"),
      carried("chroma", "energy", { decision: "junk" }),
      carried("worn", "helmet", { equipped: true }),
      carried("strides", "legs", { equipped: true, decision: "junk", name: "Lustrous Strides" }),
      carried("ghost-shell", "other"),
      owned("on-titan", "arms", { location: "character", characterId: "titan-1" }),
      owned("vault-junk", "arms", { decision: "junk" }),
      owned("mail", "power", { location: "postmaster", characterId: HUNTER, decision: "junk" }),
    ])
    const { preview } = plan(inv, HUNTER, 600)
    expect(preview).toMatchObject({
      junk: 2,
      batches: 1,
      stash: 2,
      returnable: 1,
      equippedJunk: ["Lustrous Strides"],
      vault: { count: 559, capacity: 600, after: 561 },
      fits: true,
    })
  })

  test("does not fit when the stash would overflow the vault", () => {
    const inv = inventory(
      [carried("a", "kinetic"), carried("b", "energy"), owned("j", "arms", { decision: "junk" })],
      599,
    )
    expect(plan(inv, HUNTER, 600).preview).toMatchObject({ vault: { after: 601 }, fits: false })
  })
})

describe("stashing", () => {
  test("moves carried gear to the vault, then starts delivering batch 0", () => {
    const inv = inventory([carried("devils", "kinetic"), owned("j", "arms", { decision: "junk" })])
    const s = session(inv)
    expect(s.stage).toBe("stashing")
    expect(nextMoves(s)).toEqual([{ kind: "stash", itemInstanceId: "devils", itemHash: 100 }])
    const stashed = runMoves(s)
    expect(stashed.stash.map((e) => e.state)).toEqual(["in_vault"])
    expect(stashed.stage).toBe("delivering")
    expect(nextMoves(stashed)).toEqual([{ kind: "deliver", itemInstanceId: "j", itemHash: 100 }])
  })

  test("a restart mid-move converges: items already where they were headed are promoted", () => {
    const inv = inventory([
      carried("a", "kinetic"),
      carried("b", "energy"),
      owned("j", "arms", { decision: "junk" }),
    ])
    const s = session(inv)
    const [first] = nextMoves(s)
    if (first === undefined) throw new Error("expected a stash move")
    const interrupted = begin(s, first)
    expect(interrupted.stash[0]?.state).toBe("moving")
    const moved = place(inv, ["a", "b"], false)
    const resumed = reconcile(interrupted, moved, NOW)
    expect(resumed.stash.map((e) => e.state)).toEqual(["in_vault", "in_vault"])
    expect(resumed.stage).toBe("delivering")
    const delivering = begin(resumed, { kind: "deliver", itemInstanceId: "j", itemHash: 100 })
    const landed = reconcile(delivering, place(moved, ["j"], true), NOW)
    expect(landed.junk[0]?.state).toBe("in_hand")
    expect(nextMoves(landed)).toEqual([])
  })
})

describe("delivering", () => {
  const inv = inventory(vaultJunk([["kinetic", 11]]))
  const delivered = runMoves(session(inv))

  test("delivers only the current batch, and the next only once nothing is left in hand", () => {
    expect(delivered.batch).toBe(0)
    expect(delivered.junk.filter((e) => e.state === "in_hand").length).toBe(9)
    expect(nextMoves(delivered)).toEqual([])

    const allButOne = remove(inv, batchIds(delivered, 0).slice(1))
    const partly = reconcile(delivered, allButOne, NOW)
    expect(partly.junk.filter((e) => e.state === "deleted").length).toBe(8)
    expect(partly.batch).toBe(0)
    expect(nextMoves(partly)).toEqual([])

    const cleared = reconcile(partly, remove(inv, batchIds(delivered, 0)), NOW)
    expect(cleared.batch).toBe(1)
    expect(nextMoves(cleared).map((m) => [m.kind, m.itemInstanceId])).toEqual([
      ["deliver", "kinetic-9"],
      ["deliver", "kinetic-10"],
    ])
  })

  test("deleting the last batch finishes the cleanup", () => {
    const second = runMoves(reconcile(delivered, remove(inv, batchIds(delivered, 0)), NOW))
    const done = reconcile(second, inventory([]), LATER)
    expect(done.stage).toBe("finished")
    expect(done.finishedAt).toBe(LATER)
    expect(done.junk.every((e) => e.state === "deleted")).toBe(true)
  })

  test("keep sends the item back to the vault and stays kept when a late delivery lands", () => {
    const fresh = session(inv)
    const [deliver] = nextMoves(fresh)
    if (deliver === undefined) throw new Error("expected a delivery")
    const inFlight = begin(fresh, deliver)
    const kept = Result.getOrThrow(keep(inFlight, [deliver.itemInstanceId]))
    const landed = settle(kept, deliver, "landed", NOW)
    expect(landed.junk[0]?.state).toBe("keeping")
    const stow = nextMoves(landed).find((m) => m.itemInstanceId === deliver.itemInstanceId)
    expect(stow?.kind).toBe("stow")
    if (stow === undefined) throw new Error("expected a stow move")
    expect(settle(landed, stow, "landed", NOW).junk[0]?.state).toBe("kept")
  })

  test("keep refuses an item outside the current batch", () => {
    expect(Result.isFailure(keep(delivered, ["kinetic-10"]))).toBe(true)
  })

  test("skip returns what is left of the batch to the vault and moves on", () => {
    const one = reconcile(delivered, remove(inv, ["kinetic-0"]), NOW)
    const skipping = Result.getOrThrow(skip(one))
    expect(skipping.batch).toBe(0)
    expect(nextMoves(skipping).filter((m) => m.kind === "stow").length).toBe(8)
    const skipped = runMoves(skipping)
    expect(skipped.junk.filter((e) => e.batch === 0).map((e) => e.state)).toEqual([
      "deleted",
      ...Array(8).fill("skipped"),
    ])
    expect(skipped.batch).toBe(1)
  })

  test("keep takes several items at once and refuses the lot if any is outside the batch", () => {
    const both = Result.getOrThrow(keep(delivered, ["kinetic-0", "kinetic-1"]))
    expect(both.junk.slice(0, 3).map((e) => e.state)).toEqual(["keeping", "keeping", "in_hand"])
    expect(Result.isFailure(keep(delivered, ["kinetic-0", "kinetic-10"]))).toBe(true)
  })

  test("finishing the last batch counts items the stale profile still showed as deleted", () => {
    const last = runMoves(reconcile(delivered, remove(inv, batchIds(delivered, 0)), NOW))
    const skipping = Result.getOrThrow(skip(last))
    const [gone, back] = nextMoves(skipping)
    if (gone === undefined || back === undefined) throw new Error("expected two stows")
    const settled = settle(settle(skipping, gone, "gone", LATER), back, "landed", LATER)
    expect(settled.junk.filter((e) => e.batch === 1).map((e) => e.state)).toEqual([
      "deleted",
      "skipped",
    ])
    expect(settled.error).toBeNull()
    expect(settled.stage).toBe("finished")
  })

  test("a failed item the profile no longer has counts as deleted", () => {
    const fresh = session(inv)
    const [first] = nextMoves(fresh)
    if (first === undefined) throw new Error("expected a delivery")
    const failed = settle(begin(fresh, first), first, { failed: "DestinyNoRoomInDestination" }, NOW)
    expect(reconcile(failed, remove(inv, ["kinetic-0"]), NOW).junk[0]?.state).toBe("deleted")
  })

  test("a failed transfer marks only that item failed and records why", () => {
    const fresh = session(inv)
    const [first, second] = nextMoves(fresh)
    if (first === undefined || second === undefined) throw new Error("expected deliveries")
    const failed = settle(begin(fresh, first), first, { failed: "DestinyNoRoomInDestination" }, NOW)
    expect(failed.junk[0]?.state).toBe("failed")
    expect(failed.error).toBe("DestinyNoRoomInDestination")
    const next = settle(begin(failed, second), second, "landed", NOW)
    expect(next.junk[1]?.state).toBe("in_hand")
    expect(next.error).toBeNull()
  })

  test("pausing holds deliveries but still stows kept items", () => {
    const fresh = session(inv)
    const paused = Result.getOrThrow(command(fresh, "pause", NOW))
    expect(nextMoves(paused)).toEqual([])
    const kept = Result.getOrThrow(keep(paused, ["kinetic-0"]))
    expect(nextMoves(kept).map((m) => m.kind)).toEqual(["stow"])
    expect(Result.isFailure(command(fresh, "resume", NOW))).toBe(true)
    expect(Result.getOrThrow(command(paused, "resume", NOW)).stage).toBe("delivering")
  })
})

describe("returning", () => {
  test("returns the non-junk the character carried, then closes", () => {
    const inv = inventory([
      carried("devils", "kinetic"),
      carried("chroma", "energy", { decision: "junk" }),
    ])
    const stashed = runMoves(session(inv))
    const vaulted = place(inv, ["devils", "chroma"], false)
    const finished = reconcile(stashed, remove(vaulted, ["chroma"]), LATER)
    expect(finished.stage).toBe("finished")
    const returning = Result.getOrThrow(command(finished, "return", LATER))
    expect(returning.stage).toBe("returning")
    expect(nextMoves(returning)).toEqual([
      { kind: "return", itemInstanceId: "devils", itemHash: 100 },
    ])
    const back = reconcile(returning, place(vaulted, ["devils"], true), LATER)
    expect(back.stash.find((e) => e.itemInstanceId === "devils")?.state).toBe("returned")
    expect(back.stage).toBe("closed")
  })

  test("returning with nothing to bring back closes at once", () => {
    const inv = inventory([owned("j", "arms", { decision: "junk" })])
    const finished = reconcile(runMoves(session(inv)), inventory([]), LATER)
    expect(Result.getOrThrow(command(finished, "return", LATER)).stage).toBe("closed")
  })
})
