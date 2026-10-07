import { ARMOR_STATS } from "../bungie/masterwork.ts"
import { type Inventory, isArmor, isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import { covers, keepable, type RatedColumns, rated } from "./perks.ts"

export type Protection =
  | "locked"
  | "masterworked"
  | "equipped"
  | "crafted"
  | "marked_keep"
  | "in_build"
  | "in_loadout"
  | "good_roll"
  | "only_copy"
  | "best_copy"
  | "recent"
  | "unread_tuning"

export type Signal =
  | {
      readonly kind: "duplicate"
      readonly better: string
      /** The good and ok perks the better copy also slots; empty when copies are not compared by roll. */
      readonly shared: ReadonlyArray<string>
    }
  | { readonly kind: "weak_roll"; readonly perks: ReadonlyArray<string> }
  | { readonly kind: "trash_roll"; readonly score: number }

export type Verdict =
  | { readonly verdict: "junk"; readonly signals: ReadonlyArray<Signal> }
  | { readonly verdict: "review"; readonly signals: ReadonlyArray<Signal>; readonly why: string }
  | { readonly verdict: "keep"; readonly protections: ReadonlyArray<Protection> }

export interface RollStanding {
  readonly wishlist: boolean
  readonly trash: boolean
  readonly score: number | null
}

export interface JudgeContext {
  readonly builds: ReadonlySet<string>
  readonly loadouts: ReadonlySet<string>
  readonly rolls: ReadonlyMap<string, RollStanding>
  /** Each weapon's trait columns with every perk rated. */
  readonly columns: ReadonlyMap<string, RatedColumns>
  readonly now: number
}

/** Items this new are only ever reviewed: the player may not have looked at them yet. */
export const RECENT_MS = 48 * 60 * 60 * 1000

// A hard protection keeps the item off the proposal; a soft one lets it be
// listed for review but never ticked as junk.
const HARD: ReadonlyArray<readonly [Protection, (item: OwnedItem, ctx: JudgeContext) => boolean]> =
  [
    ["locked", (item) => item.locked],
    ["masterworked", (item) => item.masterwork],
    ["equipped", (item) => item.equipped],
    ["crafted", (item) => item.crafted],
    ["marked_keep", (item) => item.decision === "keep"],
    ["in_build", (item, ctx) => ctx.builds.has(item.itemInstanceId)],
    ["in_loadout", (item, ctx) => ctx.loadouts.has(item.itemInstanceId)],
  ]

const SOFT_WHY: Record<"only_copy" | "best_copy" | "recent" | "unread_tuning", string> = {
  only_copy: "your only copy",
  best_copy: "your best copy",
  recent: "picked up in the last two days",
  unread_tuning: "its tuned stat could not be read",
}

// Tier 5 armor rolls a tuned stat its visible stats do not show, so a copy
// whose tuning is unknown may be the only one tuned the way the player wants.
const unreadTuning = (item: OwnedItem) =>
  isArmor(item.slot) && item.gearTier === 5 && item.tuning === null

const statProfile = (item: OwnedItem) => {
  const stats = item.armorStats
  if (stats === null) return ""
  return ARMOR_STATS.map(([key]) => [key, stats[key]] as const)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key)
    .join("/")
}

// Armor copies serve the same role when one could stand in for the other:
// same class and slot, same set (or the same item), the same archetype and
// tertiary, read from the three highest stats, and the same rolled exotic
// perks, which is what sets one exotic class item apart from another. Copies
// of one tier are only weighed against each other when tuned the same way.
const roleKey = (item: OwnedItem) =>
  isWeapon(item.slot)
    ? `weapon|${item.itemHash}`
    : `armor|${item.classType}|${item.slot}|${item.set?.name ?? item.itemHash}|${statProfile(item)}|${item.intrinsics.toSorted().join("/")}`

const groupKey = (item: OwnedItem) =>
  isWeapon(item.slot) ? roleKey(item) : `${roleKey(item)}|${item.tuning}`

const tierOf = (item: OwnedItem) => item.gearTier ?? 0

// A higher gear tier wins outright, so a copy is only ever weighed against
// the best of its own tier or above.
const rank = (item: OwnedItem, ctx: JudgeContext) =>
  isWeapon(item.slot)
    ? [tierOf(item), ctx.rolls.get(item.itemInstanceId)?.score ?? -1, item.power ?? 0]
    : [tierOf(item), item.statTotal ?? 0, item.power ?? 0]

const betterFirst = (ctx: JudgeContext) => (a: OwnedItem, b: OwnedItem) => {
  const [ra, rb] = [rank(a, ctx), rank(b, ctx)]
  for (const [i, value] of ra.entries()) {
    const other = rb[i] ?? 0
    if (value !== other) return other - value
  }
  return a.itemInstanceId.localeCompare(b.itemInstanceId)
}

const groupBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const groups = new Map<string, Array<A>>()
  for (const item of items) {
    const k = key(item)
    groups.set(k, [...(groups.get(k) ?? []), item])
  }
  return groups
}

const NO_BETTER_COPY = "no better copy"

interface Standing {
  readonly better: OwnedItem | null
  readonly shared: ReadonlyArray<string>
  /** The roll's perks, when none of them is worth keeping. */
  readonly weak: ReadonlyArray<string> | null
  /** Why the copy stays: its roll no kept copy covers, or being the best when no roll is rated. */
  readonly kept: "roll" | "best" | null
}

type HigherTier = (item: OwnedItem) => OwnedItem | null

const bestOnly = (ordered: ReadonlyArray<OwnedItem>, higherTier: HigherTier) =>
  new Map(
    ordered.map((item, index): readonly [OwnedItem, Standing] => {
      const better = higherTier(item) ?? (index === 0 ? null : (ordered[0] ?? null))
      return [item, { better, shared: [], weak: null, kept: better === null ? "best" : null }]
    }),
  )

const valuedNames = (columns: RatedColumns) =>
  columns.flatMap((column) => column.filter((perk) => perk.rating !== "junk").map((p) => p.name))

const selectedNames = (columns: RatedColumns) =>
  columns.flatMap((column) => (column[0] === undefined ? [] : [column[0].name]))

// One copy per distinct good roll: walking from the best copy down, a copy
// stays when its roll is worth keeping and no copy already kept can slot all
// of its good and ok perks.
const byRoll = (
  ordered: ReadonlyArray<OwnedItem>,
  columnsOf: (item: OwnedItem) => RatedColumns,
  higherTier: HigherTier,
) => {
  const kept: Array<OwnedItem> = []
  for (const item of ordered) {
    const columns = columnsOf(item)
    if (
      higherTier(item) === null &&
      keepable(columns) &&
      !kept.some((other) => covers(columnsOf(other), columns))
    ) {
      kept.push(item)
    }
  }
  const fallback = kept.length === 0 ? ordered[0] : undefined
  return new Map(
    ordered.map((item): readonly [OwnedItem, Standing] => {
      const columns = columnsOf(item)
      const above = higherTier(item)
      if (above !== null) return [item, { better: above, shared: [], weak: null, kept: null }]
      if (kept.includes(item)) return [item, { better: null, shared: [], weak: null, kept: "roll" }]
      if (keepable(columns)) {
        const better = kept.find((other) => covers(columnsOf(other), columns)) ?? null
        return [item, { better, shared: valuedNames(columns), weak: null, kept: null }]
      }
      const weak = selectedNames(columns)
      return [item, { better: null, shared: [], weak, kept: item === fallback ? "best" : null }]
    }),
  )
}

/**
 * Weapons keep one copy per distinct good roll, judged by the perks each
 * copy can slot, and armor keeps the best copy of each role. A higher gear
 * tier always wins. Every other copy is junk unless something protects it.
 */
export const judge = (inv: Inventory, ctx: JudgeContext): ReadonlyMap<string, Verdict> => {
  const gear = inv.items.filter((item) => isWeapon(item.slot) || isArmor(item.slot))
  const groups = groupBy(gear, groupKey)
  const roles = groupBy(gear, roleKey)
  const higherTier = (item: OwnedItem) =>
    (roles.get(roleKey(item)) ?? [])
      .filter((copy) => tierOf(copy) > tierOf(item))
      .toSorted(betterFirst(ctx))[0] ?? null
  const columnsOf = (item: OwnedItem) => ctx.columns.get(item.itemInstanceId) ?? []
  const verdicts = new Map<string, Verdict>()

  for (const copies of groups.values()) {
    const ordered = copies.toSorted(betterFirst(ctx))
    const standings = ordered.some((item) => rated(columnsOf(item)))
      ? byRoll(ordered, columnsOf, higherTier)
      : bestOnly(ordered, higherTier)
    for (const item of ordered) {
      const standing = standings.get(item)
      if (standing === undefined) continue
      const { better, kept } = standing
      const hard = HARD.flatMap(([protection, applies]) => (applies(item, ctx) ? [protection] : []))
      const soft = [
        ...(kept === "best" && copies.length === 1 ? (["only_copy"] as const) : []),
        ...(kept === "best" && copies.length > 1 ? (["best_copy"] as const) : []),
        ...(item.acquiredAt !== null && ctx.now - Date.parse(item.acquiredAt) < RECENT_MS
          ? (["recent"] as const)
          : []),
        ...(unreadTuning(item) ? (["unread_tuning"] as const) : []),
      ]
      if (kept === "roll") {
        verdicts.set(item.itemInstanceId, { verdict: "keep", protections: [...hard, "good_roll"] })
        continue
      }
      const roll = ctx.rolls.get(item.itemInstanceId)
      const signals: ReadonlyArray<Signal> = [
        ...(better === null
          ? []
          : [
              {
                kind: "duplicate",
                better: better.itemInstanceId,
                shared: standing.shared,
              } as const,
            ]),
        ...(standing.weak === null ? [] : [{ kind: "weak_roll", perks: standing.weak } as const]),
        ...(roll?.trash === true ? [{ kind: "trash_roll", score: roll.score ?? 0 } as const] : []),
      ]
      if (hard.length > 0 || signals.length === 0) {
        verdicts.set(item.itemInstanceId, { verdict: "keep", protections: [...hard, ...soft] })
        continue
      }
      const reasons = [
        ...soft.map((protection) => SOFT_WHY[protection]),
        ...(kept === "best" ? [NO_BETTER_COPY] : []),
      ]
      verdicts.set(
        item.itemInstanceId,
        reasons.length === 0
          ? { verdict: "junk", signals }
          : { verdict: "review", signals, why: reasons.join(" · ") },
      )
    }
  }
  return verdicts
}
