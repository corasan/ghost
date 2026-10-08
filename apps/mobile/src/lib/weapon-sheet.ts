import { PerkColumn, type Purpose, type WeaponPerk, WeaponSheet } from "@ghost/contract"

/** A perk by position: the column it sits in and its place in that column. */
export type PerkRef = { readonly column: number; readonly perk: number }

/** Plug hashes staged to go in, keyed by socket index. */
export type Staged = ReadonlyMap<number, number>

export type SheetMode =
  | { readonly kind: "view"; readonly inspected: PerkRef | null }
  | { readonly kind: "apply"; readonly staged: Staged }

export const VIEWING: SheetMode = { kind: "view", inspected: null }

export const isRound = (column: Pick<PerkColumn, "label">) =>
  column.label.startsWith("TRAIT") || column.label === "ORIGIN"

export const activeOf = (column: PerkColumn) => column.perks.find((perk) => perk.active)

export const perkAt = (sheet: WeaponSheet, ref: PerkRef) =>
  sheet.columns[ref.column]?.perks[ref.perk]

/** In apply mode a tap stages a rolled perk, and tapping it again, or the active one, takes it back out. */
export const toggleStaged = (staged: Staged, column: PerkColumn, perk: WeaponPerk): Staged => {
  const next = new Map(staged)
  if (perk.active || staged.get(column.socketIndex) === perk.plugHash) {
    next.delete(column.socketIndex)
  } else if (perk.rolled) {
    next.set(column.socketIndex, perk.plugHash)
  }
  return next
}

export interface Swap {
  readonly column: PerkColumn
  readonly from: WeaponPerk
  readonly to: WeaponPerk
}

export const swapsOf = (sheet: WeaponSheet, staged: Staged): ReadonlyArray<Swap> =>
  sheet.columns.flatMap((column) => {
    const hash = staged.get(column.socketIndex)
    const from = activeOf(column)
    const to = column.perks.find((perk) => perk.plugHash === hash)
    return from === undefined || to === undefined || to === from ? [] : [{ column, from, to }]
  })

/** The swap the inspected perk would make in its column; none when it is the active one. */
export const inspectedSwap = (sheet: WeaponSheet, ref: PerkRef): ReadonlyArray<Swap> => {
  const column = sheet.columns[ref.column]
  const to = column?.perks[ref.perk]
  const from = column === undefined ? undefined : activeOf(column)
  return column === undefined || to === undefined || from === undefined || to.active
    ? []
    : [{ column, from, to }]
}

const statOf = (perk: WeaponPerk, stat: string) =>
  perk.stats.find((change) => change.stat === stat)?.value ?? 0

/** What the swaps would add to (positive) or take from each stat. */
export const statDelta = (swaps: ReadonlyArray<Swap>, stat: string) =>
  swaps.reduce((sum, swap) => sum + statOf(swap.to, stat) - statOf(swap.from, stat), 0)

/** Every stat a swap changes, with how much; the stats it leaves alone are left out. */
export const deltasOf = (swaps: ReadonlyArray<Swap>) =>
  [
    ...new Set(
      swaps.flatMap((swap) => [...swap.from.stats, ...swap.to.stats].map((change) => change.stat)),
    ),
  ].flatMap((stat) => {
    const value = statDelta(swaps, stat)
    return value === 0 ? [] : [{ stat, value }]
  })

export interface StatBar {
  readonly name: string
  readonly total: number
  /** Widths in percent of a 100-point bar. */
  readonly base: number
  readonly perks: number
  readonly gain: number
  readonly loss: number
  readonly delta: number
}

const clamp = (value: number) => Math.min(100, Math.max(0, value))

export const statBars = (sheet: WeaponSheet, swaps: ReadonlyArray<Swap>): ReadonlyArray<StatBar> =>
  sheet.stats
    .filter((stat) => stat.bar)
    .map((stat) => {
      const delta = statDelta(swaps, stat.name)
      const total = clamp(stat.value)
      return {
        name: stat.name,
        total: stat.value,
        base: clamp(stat.value - stat.fromPerks),
        perks: clamp(Math.min(stat.fromPerks, total)),
        gain: clamp(Math.min(delta, 100 - total)),
        loss: clamp(Math.min(-delta, total)),
        delta,
      }
    })

/** How many of the active perks count as good for `purpose`. */
export const goodActive = (sheet: WeaponSheet, purpose: Purpose) => {
  const active = sheet.columns.flatMap((column) => activeOf(column) ?? [])
  return { good: active.filter((perk) => perk.good.includes(purpose)).length, of: active.length }
}

/** The sheet cut down to what this copy rolled: the perk in each socket and the ones it can swap in. */
export const rolledOnly = (sheet: WeaponSheet) =>
  new WeaponSheet({
    ...sheet,
    columns: sheet.columns.map(
      (column) => new PerkColumn({ ...column, perks: column.perks.filter((perk) => perk.rolled) }),
    ),
  })

export const poolSize = (sheet: WeaponSheet) =>
  sheet.columns.reduce((sum, column) => sum + column.perks.length, 0)

/** Whether any column holds a rolled perk that is not in the socket, so there is something to apply. */
export const canSwap = (sheet: WeaponSheet) =>
  sheet.columns.some((column) => column.perks.some((perk) => perk.rolled && !perk.active))

export const signed = (value: number) => `${value > 0 ? "+" : "−"}${Math.abs(value)}`
