import { Effect } from "effect"
import type { JevService } from "../agent/jev.ts"
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
  | { readonly kind: "duplicate"; readonly better: string; readonly outclassed: number | null }
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

export interface Purpose {
  readonly name: string
  readonly purpose: string
}

export interface JudgeContext {
  readonly builds: ReadonlySet<string>
  readonly loadouts: ReadonlySet<string>
  readonly purposes: ReadonlyArray<Purpose>
  readonly rolls: ReadonlyMap<string, RollStanding>
  /** The item as Jev reads it; must be the same text for the same item every run. */
  readonly describe: (item: OwnedItem) => string
  readonly now: number
}

export const THRESHOLDS = {
  /** Jev's confidence that the better copy does everything this one does, needed to call it junk. */
  outclassed: 0.85,
  /**
   * Jev's relevance of an item to a saved build at which it is only ever
   * reviewed. Pieces a build runs without naming them score about 0.26 and a
   * named one about 0.6, so 0.35 catches what Jev rates above the build's own gear.
   */
  purpose: 0.35,
  /** Items this new are only ever reviewed: the player may not have looked at them yet. */
  recentMs: 48 * 60 * 60 * 1000,
} as const

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
// tertiary, read from the three highest stats, the same tuned stat, and the
// same rolled exotic perks, which is what sets one exotic class item apart
// from another.
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

interface Candidate {
  readonly item: OwnedItem
  readonly signals: ReadonlyArray<Signal>
  readonly soft: ReadonlyArray<keyof typeof SOFT_WHY>
  readonly better: OwnedItem | null
  /** A copy of a higher gear tier fills the same role, which settles it without Jev. */
  readonly outtiered: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

const groupBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const groups = new Map<string, Array<A>>()
  for (const item of items) {
    const k = key(item)
    groups.set(k, [...(groups.get(k) ?? []), item])
  }
  return groups
}

const duplicateDoubt = (signals: ReadonlyArray<Signal>, available: boolean) => {
  const duplicate = signals.find((signal) => signal.kind === "duplicate")
  if (duplicate === undefined) return ["no better copy"]
  if (duplicate.outclassed === null) return available ? ["Jev gave no answer"] : []
  return duplicate.outclassed < THRESHOLDS.outclassed
    ? ["Jev sees something the better copy lacks"]
    : []
}

export const judge = (
  inv: Inventory,
  ctx: JudgeContext,
  jev: JevService,
): Effect.Effect<ReadonlyMap<string, Verdict>> =>
  Effect.gen(function* () {
    const gear = inv.items.filter((item) => isWeapon(item.slot) || isArmor(item.slot))
    const groups = groupBy(gear, groupKey)
    const roles = groupBy(gear, roleKey)
    const higherTier = (item: OwnedItem) =>
      (roles.get(roleKey(item)) ?? [])
        .filter((copy) => tierOf(copy) > tierOf(item))
        .toSorted(betterFirst(ctx))[0] ?? null
    const verdicts = new Map<string, Verdict>()
    const candidates: Array<Candidate> = []

    for (const copies of groups.values()) {
      const [best, ...rest] = copies.toSorted(betterFirst(ctx))
      if (best === undefined) continue
      for (const item of [best, ...rest]) {
        const above = higherTier(item)
        const outtiered = above !== null
        const better = above ?? (item === best ? null : best)
        const soft = [
          ...(copies.length === 1 && !outtiered ? (["only_copy"] as const) : []),
          ...(item === best && copies.length > 1 && !outtiered ? (["best_copy"] as const) : []),
          ...(item.acquiredAt !== null &&
          ctx.now - Date.parse(item.acquiredAt) < THRESHOLDS.recentMs
            ? (["recent"] as const)
            : []),
          ...(unreadTuning(item) ? (["unread_tuning"] as const) : []),
        ]
        const hard = HARD.flatMap(([protection, applies]) =>
          applies(item, ctx) ? [protection] : [],
        )
        const roll = ctx.rolls.get(item.itemInstanceId)
        const signals: Array<Signal> = [
          ...(better === null
            ? []
            : [{ kind: "duplicate", better: better.itemInstanceId, outclassed: null } as const]),
          ...(roll?.trash === true
            ? [{ kind: "trash_roll", score: roll.score ?? 0 } as const]
            : []),
        ]
        if (hard.length > 0 || signals.length === 0) {
          verdicts.set(item.itemInstanceId, { verdict: "keep", protections: [...hard, ...soft] })
        } else {
          candidates.push({ item, signals, soft, better, outtiered })
        }
      }
    }

    const asked = yield* Effect.gen(function* () {
      const outclassed = new Map<string, number>()
      const duplicates = candidates.flatMap((c) =>
        c.better === null || c.outtiered ? [] : [{ ...c, better: c.better }],
      )
      for (const group of groupBy(duplicates, (c) => c.better.itemInstanceId).values()) {
        const better = group[0]?.better
        if (better === undefined) continue
        const answers = yield* jev.rank(
          ctx.describe(better),
          group.map((c) => ({ id: c.item.itemInstanceId, text: ctx.describe(c.item) })),
          "outclassed",
        )
        for (const [id, score] of answers) outclassed.set(id, score)
      }
      const fits = new Map<string, ReadonlyArray<string>>()
      for (const { name, purpose } of ctx.purposes) {
        if (candidates.every((c) => c.outtiered)) break
        const answers = yield* jev.rank(
          purpose,
          candidates
            .filter((c) => !c.outtiered)
            .map((c) => ({ id: c.item.itemInstanceId, text: ctx.describe(c.item) })),
          "item",
        )
        for (const [id, relevance] of answers) {
          if (relevance < THRESHOLDS.purpose) continue
          fits.set(id, [
            ...(fits.get(id) ?? []),
            `fits your '${name}' build ${round2(relevance).toFixed(2)}`,
          ])
        }
      }
      return { outclassed, fits }
    }).pipe(
      Effect.map((answers) => ({ ...answers, available: true })),
      Effect.catchTag("JevUnavailable", () =>
        Effect.succeed({
          outclassed: new Map<string, number>(),
          fits: new Map<string, ReadonlyArray<string>>(),
          available: false,
        }),
      ),
    )

    for (const { item, signals: raw, soft, outtiered } of candidates) {
      const id = item.itemInstanceId
      const answer = asked.outclassed.get(id)
      const signals = raw.map((signal) =>
        signal.kind === "duplicate"
          ? { ...signal, outclassed: answer === undefined ? null : round2(answer) }
          : signal,
      )
      const reasons = [
        ...soft.map((protection) => SOFT_WHY[protection]),
        ...(outtiered
          ? []
          : [
              ...(asked.available ? [] : ["Jev was unavailable, so nothing is called junk"]),
              ...(asked.fits.get(id) ?? []),
              ...duplicateDoubt(signals, asked.available),
            ]),
      ]
      verdicts.set(
        id,
        reasons.length === 0
          ? { verdict: "junk", signals }
          : { verdict: "review", signals, why: reasons.join(" · ") },
      )
    }
    return verdicts
  })
