import { describe, expect, test } from "bun:test"
import type { ActionRecord } from "../db/actions.ts"
import { historyCalls } from "./history.ts"

type Call = Pick<ActionRecord, "kind" | "status" | "name" | "characterId">
const call = (
  kind: Call["kind"],
  status: Call["status"] = "ok",
  name = "Item",
  characterId: string | null = null,
): Call => ({ kind, status, name, characterId })

const labels = (calls: ReadonlyArray<Call>) =>
  historyCalls(calls).map((c) => `${c.label} [${c.status}]`)

describe("historyCalls", () => {
  test("groups by kind, destination and status in first-seen order", () => {
    const calls = [
      ...Array.from({ length: 8 }, () => call("pull_postmaster")),
      ...Array.from({ length: 7 }, () => call("to_vault")),
      call("to_vault", "failed"),
      call("equip"),
      call("equip"),
      call("equip"),
      call("tag_junk"),
      call("tag_junk"),
    ]
    expect(labels(calls)).toEqual([
      "pullFromPostmaster ×8 [ok]",
      "transferItem → vault ×7 [ok]",
      "transferItem → vault [failed]",
      "equipItem ×3 [ok]",
      "tagJunk ×2 [ok]",
    ])
  })

  test("a single held item is named, several are counted", () => {
    expect(labels([call("held", "held", "Taipan-4fr")])).toEqual(["Taipan-4fr · held [held]"])
    expect(labels([call("held", "held"), call("held", "held")])).toEqual(["held ×2 [held]"])
  })

  test("transfers to different characters stay separate; undone calls group apart", () => {
    const calls = [
      call("to_character", "ok", "A", "c1"),
      call("to_character", "ok", "B", "c2"),
      call("to_vault", "undone"),
      call("to_vault", "undone"),
    ]
    expect(labels(calls)).toEqual([
      "transferItem → character [ok]",
      "transferItem → character [ok]",
      "transferItem → vault ×2 [undone]",
    ])
  })

  test("armor mod and subclass plug inserts are told apart", () => {
    const calls = [
      call("insert_subclass_plug"),
      call("insert_mod"),
      call("insert_subclass_plug"),
      call("insert_mod"),
    ]
    expect(labels(calls)).toEqual([
      "insertSocketPlugFree → subclass ×2 [ok]",
      "insertSocketPlugFree → mod ×2 [ok]",
    ])
  })

  test("no actions, no calls", () => {
    expect(historyCalls([])).toEqual([])
  })
})
