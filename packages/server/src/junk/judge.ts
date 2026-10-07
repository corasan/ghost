import { ARMOR_STATS } from "../bungie/masterwork.ts"
import { type Inventory, isArmor, isWeapon, type OwnedItem } from "../bungie/inventory.ts"

export type Protection =
  | "locked"
  | "masterworked"
  | "equipped"
  | "crafted"
  | "marked_keep"
  | "in_build"
  | "in_loadout"
  | "wishlist_roll"
  | "only_copy"
  | "best_copy"
  | "recent"
  | "unread_tuning"

export type Signal =
  | { readonly kind: "duplicate"; readonly better: string }
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
    ["wishlist_roll", (item, ctx) => ctx.rolls.get(item.itemInstanceId)?.wishlist === true],
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

/**
 * Only the best copy of each weapon, and of each armor role, is worth
 * keeping, and a higher gear tier is always the better copy. Every other copy
 * is junk unless something protects it.
 */
export const judge = (inv: Inventory, ctx: JudgeContext): ReadonlyMap<string, Verdict> => {
  const gear = inv.items.filter((item) => isWeapon(item.slot) || isArmor(item.slot))
  const groups = groupBy(gear, groupKey)
  const roles = groupBy(gear, roleKey)
  const higherTier = (item: OwnedItem) =>
    (roles.get(roleKey(item)) ?? [])
      .filter((copy) => tierOf(copy) > tierOf(item))
      .toSorted(betterFirst(ctx))[0] ?? null
  const verdicts = new Map<string, Verdict>()

  for (const copies of groups.values()) {
    const [best, ...rest] = copies.toSorted(betterFirst(ctx))
    if (best === undefined) continue
    for (const item of [best, ...rest]) {
      const better = higherTier(item) ?? (item === best ? null : best)
      const soft = [
        ...(better === null && copies.length === 1 ? (["only_copy"] as const) : []),
        ...(better === null && copies.length > 1 ? (["best_copy"] as const) : []),
        ...(item.acquiredAt !== null && ctx.now - Date.parse(item.acquiredAt) < RECENT_MS
          ? (["recent"] as const)
          : []),
        ...(unreadTuning(item) ? (["unread_tuning"] as const) : []),
      ]
      const hard = HARD.flatMap(([protection, applies]) => (applies(item, ctx) ? [protection] : []))
      const roll = ctx.rolls.get(item.itemInstanceId)
      const signals: ReadonlyArray<Signal> = [
        ...(better === null ? [] : [{ kind: "duplicate", better: better.itemInstanceId } as const]),
        ...(roll?.trash === true ? [{ kind: "trash_roll", score: roll.score ?? 0 } as const] : []),
      ]
      if (hard.length > 0 || signals.length === 0) {
        verdicts.set(item.itemInstanceId, { verdict: "keep", protections: [...hard, ...soft] })
        continue
      }
      const reasons = [
        ...soft.map((protection) => SOFT_WHY[protection]),
        ...(better === null ? [NO_BETTER_COPY] : []),
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
