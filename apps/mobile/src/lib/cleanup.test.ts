import { describe, expect, test } from "bun:test"
import { CleanupSession, type GearSlot, JunkEntry, type JunkState } from "@ghost/contract"

import { batchRows, duration, say, segments, skipLabel, tally, vaultSaid } from "./cleanup"

const entry = (id: string, slot: GearSlot, batch: number, state: JunkState) =>
  new JunkEntry({
    itemInstanceId: id,
    itemHash: 1,
    name: id,
    icon: null,
    slot,
    damageType: "kinetic",
    gearTier: null,
    masterwork: false,
    meta: "",
    batch,
    state,
  })

const session = (junk: ReadonlyArray<JunkEntry>, batch: number, batches: number) =>
  new CleanupSession({
    id: "s",
    characterId: "c",
    stage: "delivering",
    startedAt: "2026-10-06T12:00:00.000Z",
    finishedAt: null,
    batch,
    batches,
    stash: [],
    junk,
    equippedJunk: [],
    vault: { before: 559, capacity: 600 },
    error: null,
  })

const twoBatches = (first: ReadonlyArray<JunkState>) =>
  session(
    [
      ...first.map((state, i) => entry(`k${i}`, "kinetic", 0, state)),
      entry("h0", "helmet", 0, "in_hand"),
      entry("k9", "kinetic", 1, "waiting"),
    ],
    0,
    2,
  )

describe("cleanup batch view", () => {
  test("rows follow slot order and pad each to nine tiles, resolved ones marked", () => {
    const rows = batchRows(twoBatches(["in_hand", "deleted", "kept"]))
    expect(rows.map((r) => [r.label, r.left])).toEqual([
      ["KINETIC", 1],
      ["HELMET", 1],
    ])
    expect(
      rows[0]?.tiles.map((t) => (t.kind === "done" ? `done:${t.resolution}` : t.kind)),
    ).toEqual(["item", "done:deleted", "done:kept", ...Array(6).fill("empty")])
  })

  test("copy and the skip button follow how much is left and which batch it is", () => {
    const full = twoBatches(["in_hand", "in_hand"])
    expect(say(full)).toBe(
      "Delete these in game, up to nine per slot. I’ll send the next batch when they’re gone.",
    )
    expect(skipLabel(full)).toBe("SKIP REST")
    expect(say(twoBatches(["in_hand", "deleted"]))).toBe(
      "2 to go. I’ll send the next batch when they’re gone.",
    )
    const last = session([entry("k9", "kinetic", 1, "in_hand")], 1, 2)
    expect(say(last)).toBe("Delete these in game. That finishes the cleanup.")
    expect(skipLabel(last)).toBe("FINISH")
    expect(skipLabel(session([entry("k9", "kinetic", 1, "deleted")], 1, 2))).toBe("DONE")
  })

  test("segments are weighted by batch size and coloured by progress", () => {
    const s = session(
      [
        entry("a", "kinetic", 0, "deleted"),
        entry("b", "kinetic", 0, "kept"),
        entry("c", "arms", 1, "in_hand"),
        entry("d", "arms", 2, "waiting"),
      ],
      1,
      3,
    )
    expect(segments(s)).toEqual([
      { weight: 2, tone: "clear" },
      { weight: 1, tone: "current" },
      { weight: 1, tone: "ahead" },
    ])
  })

  test("tally counts items on their way back with where they are going", () => {
    const s = twoBatches(["deleted", "keeping", "skipping", "skipped", "failed"])
    expect(tally(s)).toEqual({ deleted: 1, kept: 1, skipped: 2, failed: 1 })
  })
})

describe("cleanup copy", () => {
  test("durations read in minutes, then hours", () => {
    expect(duration("2026-10-06T12:00:00Z", "2026-10-06T12:00:20Z")).toBe("under a minute")
    expect(duration("2026-10-06T12:00:00Z", "2026-10-06T12:41:00Z")).toBe("41 min")
    expect(duration("2026-10-06T12:00:00Z", "2026-10-06T13:05:00Z")).toBe("1 h 5 min")
  })

  test("the vault line warns only when the vault is nearly full", () => {
    expect(vaultSaid(559, 600, 118)).toBe("The vault is nearly full. 118 items are tagged junk.")
    expect(vaultSaid(400, 600, 1)).toBe("1 item is tagged junk.")
    expect(vaultSaid(400, 600, 0)).toBe("Nothing is tagged junk.")
  })
})
