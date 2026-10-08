import {
  CleanupPreview,
  CleanupSession,
  type CleanupStage,
  type GearSlot,
  JunkEntry,
  type JunkState,
  type ItemSlot,
  StashEntry,
  type StashState,
} from "@ghost/contract"
import { Result } from "effect"
import type { Inventory, OwnedItem } from "../bungie/inventory.ts"
import { hardProtections, type InUse } from "../junk/judge.ts"

/** A bucket holds ten, and one of them is the equipped item. */
export const SLOT_ROOM = 9

export interface CleanupPlan {
  readonly preview: CleanupPreview
  readonly stash: ReadonlyArray<StashEntry>
  readonly junk: ReadonlyArray<JunkEntry>
  readonly capacity: number
}

export type MoveKind = "stash" | "deliver" | "stow" | "return"

export interface Move {
  readonly kind: MoveKind
  readonly itemInstanceId: string
  readonly itemHash: number
}

export const destination = (kind: MoveKind) =>
  kind === "stash" || kind === "stow" ? ("vault" as const) : ("character" as const)

type GearItem = OwnedItem & { readonly slot: GearSlot }

const isGear = (item: OwnedItem): item is GearItem => item.slot !== ("other" satisfies ItemSlot)

const metaOf = (item: OwnedItem) =>
  [
    item.typeName,
    item.statTotal === null ? null : `Total ${item.statTotal}`,
    item.duplicates > 0 ? "Duplicate" : null,
  ]
    .filter((part) => part !== null)
    .join(" · ")

const entryFields = (item: GearItem) => ({
  itemInstanceId: item.itemInstanceId,
  itemHash: item.itemHash,
  name: item.name,
  icon: item.icon,
  slot: item.slot,
  damageType: item.damageType,
  gearTier: item.gearTier ?? null,
  masterwork: item.masterwork,
  meta: metaOf(item),
})

export const assignBatches = <T extends { readonly slot: GearSlot }>(
  items: ReadonlyArray<T>,
): ReadonlyArray<{ readonly item: T; readonly batch: number }> => {
  const placed = new Map<GearSlot, number>()
  return items.map((item) => {
    const index = placed.get(item.slot) ?? 0
    placed.set(item.slot, index + 1)
    return { item, batch: Math.floor(index / SLOT_ROOM) }
  })
}

const batchCount = (batched: ReadonlyArray<{ readonly batch: number }>) =>
  batched.reduce((most, { batch }) => Math.max(most, batch + 1), 0)

/**
 * Without the vault component every vault item reads as gone. A profile
 * that shows an empty vault while the session has gear stashed there is
 * taken as one Bungie sent without it, so nothing is settled from it.
 */
export const vaultRead = (s: CleanupSession, inv: Inventory) =>
  inv.vaultCount > 0 ||
  inv.items.some((item) => item.location === "vault") ||
  !s.stash.some((e) => e.state === "in_vault")

/**
 * An item tagged junk is handed over only while nothing protects it: it may
 * have been locked, masterworked, crafted or put in a build or loadout
 * since it was tagged. An equipped one is named instead, for the player to
 * take off.
 */
export const plan = (
  inv: Inventory,
  characterId: string,
  capacity: number,
  used: InUse,
): CleanupPlan => {
  const gear = inv.items.filter(isGear)
  const junk = gear.filter(
    (i) =>
      i.decision === "junk" &&
      i.location !== "postmaster" &&
      hardProtections(i, used).every((protection) => protection === "equipped"),
  )
  const carried = gear.filter(
    (i) => i.location === "character" && i.characterId === characterId && !i.equipped,
  )
  const batched = assignBatches(junk.filter((i) => !i.equipped))
  const stash = carried.map(
    (item) =>
      new StashEntry({ ...entryFields(item), junk: item.decision === "junk", state: "queued" }),
  )
  // Junk on another character passes through the vault on its way over, so
  // the vault needs one free slot beyond what the stash fills.
  const passing = batched.some(
    ({ item }) => item.location === "character" && item.characterId !== characterId,
  )
  const after = inv.vaultCount + stash.length
  return {
    capacity,
    stash,
    junk: batched.map(
      ({ item, batch }) => new JunkEntry({ ...entryFields(item), batch, state: "waiting" }),
    ),
    preview: new CleanupPreview({
      characterId,
      junk: batched.length,
      batches: batchCount(batched),
      stash: stash.length,
      returnable: stash.filter((e) => !e.junk).length,
      equippedJunk: junk.filter((i) => i.equipped).map((i) => i.name),
      vault: { count: inv.vaultCount, capacity, after },
      fits: after + (passing ? 1 : 0) <= capacity,
    }),
  }
}

const PENDING_STASH = new Set<StashState>(["queued", "moving"])
const UNRESOLVED_JUNK = new Set<JunkState>(["waiting", "moving", "in_hand", "keeping", "skipping"])

const returnable = (e: StashEntry) => !e.junk && e.state === "in_vault"

const withStage = (s: CleanupSession, stage: CleanupStage, patch: Partial<CleanupSession> = {}) =>
  new CleanupSession({ ...s, ...patch, stage })

export const advance = (s: CleanupSession, now: string): CleanupSession => {
  switch (s.stage) {
    case "stashing":
      return s.stash.some((e) => PENDING_STASH.has(e.state))
        ? s
        : advance(withStage(s, "delivering"), now)
    case "delivering": {
      let batch = s.batch
      while (
        batch < s.batches &&
        s.junk.every((e) => e.batch !== batch || !UNRESOLVED_JUNK.has(e.state))
      ) {
        batch += 1
      }
      if (batch >= s.batches) {
        return withStage(s, "finished", { batch: Math.max(0, s.batches - 1), finishedAt: now })
      }
      return batch === s.batch ? s : new CleanupSession({ ...s, batch })
    }
    case "returning":
      return s.stash.some(returnable) ? s : withStage(s, "closed")
    default:
      return s
  }
}

export const start = (planned: CleanupPlan, id: string, now: string): CleanupSession =>
  advance(
    new CleanupSession({
      id,
      characterId: planned.preview.characterId,
      stage: "stashing",
      startedAt: now,
      finishedAt: null,
      batch: 0,
      batches: planned.preview.batches,
      stash: planned.stash,
      junk: planned.junk,
      equippedJunk: planned.preview.equippedJunk,
      vault: { before: planned.preview.vault.count, capacity: planned.capacity },
      error: null,
    }),
    now,
  )

/**
 * Folds what the profile shows into the session. Only promotes an entry to
 * where it was headed, or to deleted when the item is gone from the whole
 * profile, so a stale profile never undoes a move and a restart mid-move
 * converges.
 */
export const reconcile = (s: CleanupSession, inv: Inventory, now: string): CleanupSession => {
  const owned = new Map(inv.items.map((item) => [item.itemInstanceId, item]))
  const onCharacter = (id: string) => {
    const item = owned.get(id)
    return item?.location === "character" && item.characterId === s.characterId
  }
  const inVault = (id: string) => owned.get(id)?.location === "vault"
  const handing = s.stage === "delivering" || s.stage === "paused"
  const complete = vaultRead(s, inv)

  const stash = s.stash.map((e) => {
    if (PENDING_STASH.has(e.state) && inVault(e.itemInstanceId)) {
      return new StashEntry({ ...e, state: "in_vault" })
    }
    if (s.stage === "returning" && returnable(e) && onCharacter(e.itemInstanceId)) {
      return new StashEntry({ ...e, state: "returned" })
    }
    return e
  })

  const junk = s.junk.map((e) => {
    const id = e.itemInstanceId
    if (complete && (UNRESOLVED_JUNK.has(e.state) || e.state === "failed") && !owned.has(id))
      return new JunkEntry({ ...e, state: "deleted" })
    if (e.state === "keeping" && inVault(id)) return new JunkEntry({ ...e, state: "kept" })
    if (e.state === "skipping" && inVault(id)) return new JunkEntry({ ...e, state: "skipped" })
    if (
      handing &&
      e.batch === s.batch &&
      (e.state === "waiting" || e.state === "moving") &&
      onCharacter(id)
    ) {
      return new JunkEntry({ ...e, state: "in_hand" })
    }
    return e
  })

  return advance(new CleanupSession({ ...s, stash, junk }), now)
}

const moveOf = (kind: MoveKind, e: StashEntry | JunkEntry): Move => ({
  kind,
  itemInstanceId: e.itemInstanceId,
  itemHash: e.itemHash,
})

const stows = (s: CleanupSession) =>
  s.junk
    .filter((e) => e.state === "keeping" || e.state === "skipping")
    .map((e) => moveOf("stow", e))

export const nextMoves = (s: CleanupSession): ReadonlyArray<Move> => {
  switch (s.stage) {
    case "stashing":
      return s.stash.filter((e) => PENDING_STASH.has(e.state)).map((e) => moveOf("stash", e))
    case "delivering":
      return [
        ...stows(s),
        ...s.junk
          .filter((e) => e.batch === s.batch && (e.state === "waiting" || e.state === "moving"))
          .map((e) => moveOf("deliver", e)),
      ]
    case "paused":
      return stows(s)
    case "returning":
      return s.stash.filter(returnable).map((e) => moveOf("return", e))
    default:
      return []
  }
}

const STASH_LANDING: Partial<Record<MoveKind, ReadonlyMap<StashState, StashState>>> = {
  stash: new Map([["moving", "in_vault"]]),
  return: new Map([["in_vault", "returned"]]),
}

const JUNK_LANDING: Partial<Record<MoveKind, ReadonlyMap<JunkState, JunkState>>> = {
  deliver: new Map([["moving", "in_hand"]]),
  stow: new Map([
    ["keeping", "kept"],
    ["skipping", "skipped"],
  ]),
}

const onEntry = (
  s: CleanupSession,
  move: Move,
  stash: (state: StashState) => StashState,
  junk: (state: JunkState) => JunkState,
) =>
  new CleanupSession({
    ...s,
    stash: s.stash.map((e) =>
      e.itemInstanceId === move.itemInstanceId
        ? new StashEntry({ ...e, state: stash(e.state) })
        : e,
    ),
    junk: s.junk.map((e) =>
      e.itemInstanceId === move.itemInstanceId ? new JunkEntry({ ...e, state: junk(e.state) }) : e,
    ),
  })

export const begin = (s: CleanupSession, move: Move): CleanupSession =>
  onEntry(
    s,
    move,
    (state) => (move.kind === "stash" && state === "queued" ? "moving" : state),
    (state) => (move.kind === "deliver" && state === "waiting" ? "moving" : state),
  )

/** `gone` means the item no longer exists, which for handed-over junk means the player deleted it. */
export type Outcome = "landed" | "gone" | { readonly failed: string }

/**
 * Records how a transfer went. An entry that changed while the transfer ran
 * (kept while it was being delivered) keeps its new state.
 */
export const settle = (
  s: CleanupSession,
  move: Move,
  outcome: Outcome,
  now: string,
): CleanupSession => {
  const land =
    <S extends string>(landing: ReadonlyMap<S, S> | undefined, failed: S) =>
    (state: S): S => {
      const to = landing?.get(state)
      return to === undefined ? state : outcome === "landed" ? to : failed
    }
  const next = onEntry(
    s,
    move,
    land(STASH_LANDING[move.kind], "failed"),
    outcome === "gone" ? () => "deleted" : land(JUNK_LANDING[move.kind], "failed"),
  )
  const error = outcome === "landed" || outcome === "gone" ? null : outcome.failed
  return advance(new CleanupSession({ ...next, error }), now)
}

export type CleanupCommand = "pause" | "resume" | "stop" | "return" | "close"

const COMMANDS: Record<
  CleanupCommand,
  { readonly from: ReadonlySet<CleanupStage>; readonly to: CleanupStage }
> = {
  pause: { from: new Set(["delivering"]), to: "paused" },
  resume: { from: new Set(["paused"]), to: "delivering" },
  stop: { from: new Set(["stashing", "delivering", "paused"]), to: "stopped" },
  return: { from: new Set(["finished"]), to: "returning" },
  close: { from: new Set(["finished"]), to: "closed" },
}

export const command = (
  s: CleanupSession,
  name: CleanupCommand,
  now: string,
): Result.Result<CleanupSession, string> => {
  const { from, to } = COMMANDS[name]
  if (!from.has(s.stage)) return Result.fail(`Cannot ${name} a cleanup that is ${s.stage}.`)
  // Stopping after gear was stashed ends like a finished cleanup, so the
  // player can still have it returned instead of finding it in the vault.
  if (name === "stop" && s.stash.some(returnable)) {
    return Result.succeed(withStage(s, "finished", { finishedAt: now }))
  }
  return Result.succeed(advance(withStage(s, to), now))
}

const handingOver = (s: CleanupSession) => s.stage === "delivering" || s.stage === "paused"

const HANDED = new Set<JunkState>(["waiting", "moving", "in_hand"])

export const keep = (
  s: CleanupSession,
  itemInstanceIds: ReadonlyArray<string>,
): Result.Result<CleanupSession, string> => {
  const picked = new Set(itemInstanceIds)
  const handed = s.junk.filter(
    (e) => picked.has(e.itemInstanceId) && e.batch === s.batch && HANDED.has(e.state),
  )
  if (!handingOver(s) || picked.size === 0 || handed.length !== picked.size) {
    return Result.fail("Those items are not in the batch Ghost handed over.")
  }
  return Result.succeed(
    new CleanupSession({
      ...s,
      junk: s.junk.map((e) =>
        picked.has(e.itemInstanceId) ? new JunkEntry({ ...e, state: "keeping" }) : e,
      ),
    }),
  )
}

export const skip = (s: CleanupSession): Result.Result<CleanupSession, string> =>
  handingOver(s)
    ? Result.succeed(
        new CleanupSession({
          ...s,
          junk: s.junk.map((e) =>
            e.batch === s.batch && HANDED.has(e.state)
              ? new JunkEntry({ ...e, state: "skipping" })
              : e,
          ),
        }),
      )
    : Result.fail(`Cannot skip a cleanup that is ${s.stage}.`)

export const markDeleted = (
  s: CleanupSession,
  itemInstanceIds: ReadonlyArray<string>,
  now: string,
): Result.Result<CleanupSession, string> => {
  const picked = new Set(itemInstanceIds)
  const held = s.junk.filter(
    (e) => picked.has(e.itemInstanceId) && e.batch === s.batch && e.state === "in_hand",
  )
  if (!handingOver(s) || picked.size === 0 || held.length !== picked.size) {
    return Result.fail("Only items on your character can be marked deleted.")
  }
  return Result.succeed(
    advance(
      new CleanupSession({
        ...s,
        junk: s.junk.map((e) =>
          picked.has(e.itemInstanceId) ? new JunkEntry({ ...e, state: "deleted" }) : e,
        ),
      }),
      now,
    ),
  )
}
