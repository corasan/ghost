import { type GearSlot, type PlanAction, ReviewItem } from "@ghost/contract"
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
  good_roll: "it has a good roll no other copy covers",
  only_copy: "it is the only copy",
  best_copy: "it is the best copy",
  recent: "it was picked up in the last two days",
  unread_tuning: "its tuned stat could not be read",
}

const signalText = (signal: Signal, item: OwnedItem, items: Judgment["items"]) => {
  if (signal.kind === "trash_roll") return `Trash roll · ${signal.score}/100`
  if (signal.kind === "weak_roll") {
    return signal.perks.length === 0
      ? "No good perks"
      : `No good perks · ${signal.perks.join(", ")}`
  }
  const better = items.get(signal.better)
  const stats =
    item.statTotal !== null && better?.statTotal !== null && better !== undefined
      ? ` · total ${item.statTotal} vs ${better.statTotal}`
      : ""
  const tiers =
    better?.gearTier != null && (item.gearTier ?? 0) < better.gearTier
      ? ` · tier ${item.gearTier ?? "—"} vs ${better.gearTier}`
      : ""
  const shared = signal.shared.length === 0 ? "" : ` · same good perks: ${signal.shared.join(", ")}`
  return `Duplicate of ${better?.name ?? "a better copy"}${better?.power ? ` ${better.power}` : ""}${tiers}${stats}${shared}`
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

const isGear = (item: OwnedItem): item is OwnedItem & { readonly slot: GearSlot } =>
  item.slot !== "other"

/** The review rows the player has not decided on yet. */
export const reviewItems = (
  judgment: Judgment,
  decided: (itemInstanceId: string) => boolean,
): ReadonlyArray<ReviewItem> =>
  flagged(judgment).flatMap(({ item, verdict, reason }) =>
    verdict === "review" && isGear(item) && !decided(item.itemInstanceId)
      ? [
          new ReviewItem({
            itemInstanceId: item.itemInstanceId,
            itemHash: item.itemHash,
            name: item.name,
            icon: item.icon,
            slot: item.slot,
            damageType: item.damageType,
            gearTier: item.gearTier ?? null,
            masterwork: item.masterwork,
            meta: [item.typeName, item.power === null ? null : String(item.power)]
              .filter((part) => part !== null)
              .join(" · "),
            reason,
          }),
        ]
      : [],
  )

export interface Unrated {
  readonly name: string
  readonly copies: number
  /** Every perk the player's copies can slot, per trait column. */
  readonly columns: ReadonlyArray<ReadonlyArray<string>>
}

const CURATED = new Set(["player", "claude", "wishlist"])

/**
 * Weapons with more than one copy that nothing but the community count rates,
 * most copies first: what is worth looking up and rating.
 */
export const unrated = (judgment: Judgment): ReadonlyArray<Unrated> => {
  const byName = new Map<string, Array<OwnedItem>>()
  for (const [id, columns] of judgment.columns) {
    const item = judgment.items.get(id)
    if (item === undefined || columns.length === 0) continue
    byName.set(item.name, [...(byName.get(item.name) ?? []), item])
  }
  return [...byName]
    .filter(
      ([, copies]) =>
        copies.length > 1 &&
        !copies.some((copy) =>
          (judgment.columns.get(copy.itemInstanceId) ?? []).some((column) =>
            column.some((perk) => perk.source !== null && CURATED.has(perk.source)),
          ),
        ),
    )
    .map(([name, copies]) => {
      const width = Math.max(...copies.map((copy) => copy.traits.length))
      return {
        name,
        copies: copies.length,
        columns: Array.from({ length: width }, (_, index) => [
          ...new Set(copies.flatMap((copy) => copy.traits[index] ?? [])),
        ]),
      }
    })
    .toSorted((a, b) => b.copies - a.copies || a.name.localeCompare(b.name))
}
