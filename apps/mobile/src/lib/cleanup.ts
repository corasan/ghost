import type { CleanupSession, GearSlot, JunkEntry, JunkState, StashState } from "@ghost/contract"

/** A bucket holds ten, and one of them is the equipped item. */
export const SLOT_ROOM = 9

const SLOTS: ReadonlyArray<readonly [GearSlot, string]> = [
  ["kinetic", "KINETIC"],
  ["energy", "ENERGY"],
  ["power", "POWER"],
  ["helmet", "HELMET"],
  ["arms", "ARMS"],
  ["chest", "CHEST"],
  ["legs", "LEGS"],
  ["class", "CLASS ITEM"],
]

const HANDED = new Set<JunkState>(["waiting", "moving", "in_hand"])

export type Tile =
  | { readonly kind: "item"; readonly entry: JunkEntry; readonly arrived: boolean }
  | { readonly kind: "done"; readonly entry: JunkEntry; readonly deleted: boolean }
  | { readonly kind: "empty" }

export interface SlotRow {
  readonly slot: GearSlot
  readonly label: string
  readonly left: number
  readonly tiles: ReadonlyArray<Tile>
}

const inBatch = (s: CleanupSession, batch: number) => s.junk.filter((e) => e.batch === batch)

const tileOf = (entry: JunkEntry): Tile =>
  HANDED.has(entry.state)
    ? { kind: "item", entry, arrived: entry.state === "in_hand" }
    : { kind: "done", entry, deleted: entry.state === "deleted" }

export const batchRows = (s: CleanupSession): ReadonlyArray<SlotRow> =>
  SLOTS.flatMap(([slot, label]) => {
    const entries = inBatch(s, s.batch).filter((e) => e.slot === slot)
    if (entries.length === 0) return []
    const tiles: Array<Tile> = entries.map(tileOf)
    while (tiles.length < SLOT_ROOM) tiles.push({ kind: "empty" })
    return [{ slot, label, left: entries.filter((e) => HANDED.has(e.state)).length, tiles }]
  })

export const inHand = (s: CleanupSession) =>
  inBatch(s, s.batch).filter((e) => HANDED.has(e.state)).length

export type SegmentTone = "clear" | "current" | "ahead"

export const segments = (s: CleanupSession) =>
  Array.from({ length: s.batches }, (_, batch) => {
    const entries = inBatch(s, batch)
    const clear = entries.every((e) => !HANDED.has(e.state))
    const tone: SegmentTone = clear ? "clear" : batch === s.batch ? "current" : "ahead"
    return { weight: entries.length, tone }
  })

const isLast = (s: CleanupSession) => s.batch >= s.batches - 1

export const say = (s: CleanupSession) => {
  if (s.stage === "paused") return "Paused. I won’t send anything until you resume."
  const left = inHand(s)
  if (left === 0) return "That’s the last of them. Nice work."
  if (isLast(s)) return "Delete these in game. That finishes the cleanup."
  if (left === inBatch(s, s.batch).length) {
    return "Delete these in game, up to nine per slot. I’ll send the next batch when they’re gone."
  }
  return `${left} to go. I’ll send the next batch when they’re gone.`
}

export const skipLabel = (s: CleanupSession) =>
  inHand(s) === 0 ? "DONE" : isLast(s) ? "FINISH" : "SKIP REST"

export const tally = (s: CleanupSession) => ({
  deleted: s.junk.filter((e) => e.state === "deleted").length,
  kept: s.junk.filter((e) => e.state === "kept" || e.state === "keeping").length,
  skipped: s.junk.filter((e) => e.state === "skipped" || e.state === "skipping").length,
  failed: s.junk.filter((e) => e.state === "failed").length,
})

export const STASH_LABEL: Record<StashState, string> = {
  queued: "Queued",
  moving: "Moving…",
  in_vault: "In vault",
  returned: "Returned",
  failed: "Failed",
}

export const stashMoved = (s: CleanupSession) =>
  s.stash.filter((e) => e.state !== "queued" && e.state !== "moving").length

export const returnable = (s: CleanupSession) =>
  s.stash.filter((e) => !e.junk && e.state === "in_vault").length

const MINUTE = 60_000

export const duration = (from: string, to: string) => {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / MINUTE)
  if (minutes < 1) return "under a minute"
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`

export const stashSaid = (characterName: string, junk: number) => {
  const clearing = `Clearing room on ${characterName}. Equipped gear stays on.`
  if (junk === 0) return clearing
  return `${clearing} ${junk === 1 ? "One of these is junk and comes" : `${junk} of these are junk and come`} back in step 2.`
}

export const vaultSaid = (count: number, capacity: number, junk: number) => {
  const tagged =
    junk === 0
      ? "Nothing is tagged junk."
      : `${plural(junk, "item")} ${junk === 1 ? "is" : "are"} tagged junk.`
  return capacity > 0 && count / capacity >= 0.9 ? `The vault is nearly full. ${tagged}` : tagged
}
