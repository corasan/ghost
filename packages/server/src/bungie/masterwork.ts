import { PlanStat } from "@ghost/contract"
import { type ArmorStats, type CharacterInfo, isArmor, type OwnedItem, STAT } from "./inventory.ts"
import type { StatFacts } from "./manifest.ts"

const OFF_STAT_AT_MASTERWORK = 5

/** The six armor stats under the names the current patch gives them. */
export const ARMOR_STATS = [
  ["resilience", "HEALTH"],
  ["strength", "MELEE"],
  ["discipline", "GRENADE"],
  ["intellect", "SUPER"],
  ["recovery", "CLASS"],
  ["mobility", "WEAPONS"],
] as const satisfies ReadonlyArray<readonly [keyof ArmorStats, string]>

type StatKey = (typeof ARMOR_STATS)[number][0]

const values = (stats: ArmorStats) => ARMOR_STATS.map(([key]) => stats[key])

/**
 * What each stat becomes once the piece is masterworked. Armor rolls three
 * stats and leaves the other three at zero; each energy upgrade adds a point
 * to those three, up to five each at masterwork. Older armor that rolled all
 * six stats follows other rules, so it returns null.
 */
export const masterworked = (stats: ArmorStats): Record<StatKey, number> | null => {
  const offStats = values(stats)
    .toSorted((a, b) => a - b)
    .slice(0, 3)
  if (offStats.some((value) => value > OFF_STAT_AT_MASTERWORK)) return null
  const ceiling = offStats[2] as number
  let raised = 0
  return Object.fromEntries(
    ARMOR_STATS.map(([key]) => {
      const off = stats[key] <= ceiling && raised < 3
      if (off) raised += 1
      return [key, off ? OFF_STAT_AT_MASTERWORK : stats[key]]
    }),
  ) as Record<StatKey, number>
}

/** An armor piece's six stats, each with its masterworked value when the piece is not there yet. */
export const armorStats = (
  item: Pick<OwnedItem, "armorStats" | "masterwork">,
): ReadonlyArray<PlanStat> => {
  const stats = item.armorStats
  if (stats === null) return []
  const preview = item.masterwork ? null : masterworked(stats)
  return ARMOR_STATS.map(
    ([key, label]) =>
      new PlanStat({
        label,
        value: stats[key],
        target: false,
        ...(preview !== null && preview[key] !== stats[key] ? { masterworked: preview[key] } : {}),
      }),
  )
}

const ALIASES: Record<string, StatKey> = Object.fromEntries(
  ARMOR_STATS.flatMap(([key, label]) => [
    [key, key],
    [label.toLowerCase(), key],
  ]),
)

/**
 * Build totals as they would be with every listed piece masterworked. A
 * total whose label is not one of the six stats is left alone.
 */
export const withMasterworkTotals = (
  totals: ReadonlyArray<PlanStat>,
  pieces: ReadonlyArray<Pick<OwnedItem, "armorStats" | "masterwork">>,
): ReadonlyArray<PlanStat> => {
  const gains = new Map<StatKey, number>()
  for (const piece of pieces) {
    if (piece.armorStats === null || piece.masterwork) continue
    const preview = masterworked(piece.armorStats)
    if (preview === null) continue
    for (const [key] of ARMOR_STATS) {
      gains.set(key, (gains.get(key) ?? 0) + preview[key] - piece.armorStats[key])
    }
  }
  return totals.map((total) => {
    const key = ALIASES[total.label.trim().toLowerCase()]
    const gain = key === undefined ? 0 : (gains.get(key) ?? 0)
    return gain > 0 ? new PlanStat({ ...total, masterworked: total.value + gain }) : total
  })
}

export const statLabel = (key: StatKey, label: string, facts: StatFacts) =>
  facts[STAT[key]]?.name.toUpperCase() ?? label

type Piece = Pick<OwnedItem, "itemInstanceId" | "slot" | "armorStats" | "masterwork">

/**
 * The six stats of a build: what the character has with the incoming pieces
 * worn, and what that becomes with every worn piece masterworked. It starts from the character's own totals and swaps only the
 * armor that changes, so everything else that feeds a stat is kept.
 */
export const buildStats = ({
  character,
  worn,
  incoming,
  targets,
  facts,
  modChange,
}: {
  readonly character: Pick<CharacterInfo, "stats">
  readonly worn: ReadonlyArray<Piece>
  readonly incoming: ReadonlyArray<Piece>
  readonly targets: ReadonlyArray<string>
  readonly facts: StatFacts
  /** What the plan's mod swaps add to each stat, keyed by stat hash. */
  readonly modChange?: Readonly<Record<string, number>>
}): ReadonlyArray<PlanStat> => {
  const arriving = incoming.filter(
    (piece) =>
      isArmor(piece.slot) && !worn.some((on) => on.itemInstanceId === piece.itemInstanceId),
  )
  const leaving = worn.filter((on) => arriving.some((piece) => piece.slot === on.slot))
  const final = [...worn.filter((on) => !leaving.includes(on)), ...arriving]
  const wanted = new Set(targets.flatMap((label) => ALIASES[label.trim().toLowerCase()] ?? []))
  const sum = (pieces: ReadonlyArray<Piece>, key: StatKey) =>
    pieces.reduce((total, piece) => total + (piece.armorStats?.[key] ?? 0), 0)
  const gain = (key: StatKey) =>
    final.reduce((total, piece) => {
      if (piece.armorStats === null || piece.masterwork) return total
      const preview = masterworked(piece.armorStats)
      return preview === null ? total : total + preview[key] - piece.armorStats[key]
    }, 0)

  return ARMOR_STATS.map(([key, label]) => {
    const value =
      character.stats[key] - sum(leaving, key) + sum(arriving, key) + (modChange?.[STAT[key]] ?? 0)
    const fact = facts[STAT[key]]
    return new PlanStat({
      label: statLabel(key, label, facts),
      value,
      target: wanted.has(key),
      ...(gain(key) > 0 ? { masterworked: value + gain(key) } : {}),
      ...(fact !== undefined && fact.effect !== "" ? { effect: fact.effect } : {}),
    })
  })
}

/** A stat the player asked for that the build's totals leave below the number they named. */
export interface MissedTarget {
  readonly label: string
  readonly requested: number
  readonly value: number
}

export const missedTargets = (
  stats: ReadonlyArray<PlanStat>,
  requested: ReadonlyArray<{ readonly label: string; readonly value: number }>,
): ReadonlyArray<MissedTarget> =>
  requested.flatMap((goal) => {
    const key = ALIASES[goal.label.trim().toLowerCase()]
    const stat = stats.find((s) => ALIASES[s.label.trim().toLowerCase()] === key)
    return key === undefined || stat === undefined || stat.value >= goal.value
      ? []
      : [{ label: stat.label, requested: goal.value, value: stat.value }]
  })
