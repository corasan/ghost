import type { PlanAction } from "@ghost/contract"
import type { OwnedItem } from "../bungie/inventory.ts"
import type { Protection, Signal, Verdict } from "./judge.ts"
import type { Judgment } from "./service.ts"

const PROTECTED: Record<Protection, string> = {
  locked: "it is locked",
  masterworked: "it is masterworked",
  equipped: "it is equipped",
  crafted: "it is crafted",
  marked_keep: "the player marked it keep",
  in_build: "it is in a saved Ghost build",
  in_loadout: "it is in an in-game loadout",
  wishlist_roll: "its roll is on the wishlist",
  only_copy: "it is the only copy",
  best_copy: "it is the best copy",
  recent: "it was picked up in the last two days",
  unread_tuning: "its tuned stat could not be read",
}

const signalText = (signal: Signal, item: OwnedItem, items: Judgment["items"]) => {
  if (signal.kind === "trash_roll") return `Trash roll · ${signal.score}/100`
  const better = items.get(signal.better)
  const stats =
    item.statTotal !== null && better?.statTotal !== null && better !== undefined
      ? ` · total ${item.statTotal} vs ${better.statTotal}`
      : ""
  const outclassed =
    signal.outclassed === null ? "" : ` · outclassed ${signal.outclassed.toFixed(2)}`
  return `Duplicate of ${better?.name ?? "a better copy"}${better?.power ? ` ${better.power}` : ""}${stats}${outclassed}`
}

export const reason = (item: OwnedItem, verdict: Verdict, items: Judgment["items"]) => {
  if (verdict.verdict === "keep") {
    return verdict.protections.length === 0
      ? "Nothing wrong with it"
      : `Keep: ${verdict.protections.map((p) => PROTECTED[p]).join(", ")}`
  }
  const signals = verdict.signals.map((signal) => signalText(signal, item, items)).join(" · ")
  return verdict.verdict === "junk" ? signals : `${signals} · review: ${verdict.why}`
}

export interface Flagged {
  readonly item: OwnedItem
  readonly verdict: "junk" | "review"
  readonly reason: string
}

export const flagged = (judgment: Judgment): ReadonlyArray<Flagged> =>
  [...judgment.verdicts]
    .flatMap(([id, verdict]) => {
      const item = judgment.items.get(id)
      if (item === undefined || verdict.verdict === "keep") return []
      return [{ item, verdict: verdict.verdict, reason: reason(item, verdict, judgment.items) }]
    })
    .toSorted(
      (a, b) =>
        (a.verdict === "junk" ? 0 : 1) - (b.verdict === "junk" ? 0 : 1) ||
        a.item.name.localeCompare(b.item.name) ||
        a.item.itemInstanceId.localeCompare(b.item.itemInstanceId),
    )

export interface RequestedRow {
  readonly itemInstanceId: string
  readonly action: PlanAction
}

export interface CleanupRow {
  readonly itemInstanceId: string
  readonly action: "tag_junk"
  readonly meta: string
  readonly selected: boolean
}

/**
 * The cleanup plan's rows, rebuilt from the judgment: junk ticked, review
 * unticked, each with its reason. Refuses any row the judgment did not flag.
 */
export const cleanupRows = (
  judgment: Judgment,
  requested: ReadonlyArray<RequestedRow>,
): { readonly rows: ReadonlyArray<CleanupRow> } | { readonly errors: ReadonlyArray<string> } => {
  const errors: Array<string> = []
  const rows: Array<CleanupRow> = []
  for (const { itemInstanceId: id, action } of requested) {
    const item = judgment.items.get(id)
    const verdict = judgment.verdicts.get(id)
    if (item === undefined) {
      errors.push(`${id} is not an item the player owns`)
    } else if (action !== "tag_junk") {
      errors.push(`${item.name} (${id}) has action ${action}; a cleanup plan only tags junk`)
    } else if (verdict === undefined) {
      errors.push(`${item.name} (${id}) is not weapon or armor, so find_junk does not judge it`)
    } else if (verdict.verdict === "keep") {
      errors.push(
        verdict.protections.length === 0
          ? `${item.name} (${id}) is not flagged: nothing marks it as junk`
          : `${item.name} (${id}) cannot be tagged junk: ${verdict.protections.map((p) => PROTECTED[p]).join(", ")}`,
      )
    } else {
      rows.push({
        itemInstanceId: id,
        action: "tag_junk",
        meta: reason(item, verdict, judgment.items),
        selected: verdict.verdict === "junk",
      })
    }
  }
  return errors.length > 0 ? { errors } : { rows }
}
