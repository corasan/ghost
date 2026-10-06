import { HistoryCall } from "@ghost/contract"
import type { ActionKind, ActionRecord } from "../db/actions.ts"

// History shows what a request did as a few lines, not one line per item:
// calls are grouped by what they did, where to, and how it went, and named
// after the Bungie endpoint so the player sees exactly what was called.

const CALL_NAMES: Record<Exclude<ActionKind, "held">, string> = {
  to_vault: "transferItem → vault",
  to_character: "transferItem → character",
  pull_postmaster: "pullFromPostmaster",
  equip: "equipItem",
  tag_junk: "tagJunk",
  insert_mod: "insertSocketPlugFree → mod",
  insert_subclass_plug: "insertSocketPlugFree → subclass",
}

type Grouped = Pick<ActionRecord, "kind" | "status" | "name" | "characterId">

export const historyCalls = (actions: ReadonlyArray<Grouped>): ReadonlyArray<HistoryCall> => {
  const groups = new Map<string, [Grouped, ...Array<Grouped>]>()
  for (const action of actions) {
    const destination = action.kind === "to_character" ? action.characterId : null
    const key = `${action.kind}|${destination}|${action.status}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [action])
    else group.push(action)
  }
  return [...groups.values()].map((group) => {
    const [first] = group
    const count = group.length > 1 ? ` ×${group.length}` : ""
    const label =
      first.kind === "held"
        ? group.length === 1
          ? `${first.name ?? "item"} · held`
          : `held${count}`
        : `${CALL_NAMES[first.kind]}${count}`
    return new HistoryCall({ label, status: first.status })
  })
}
