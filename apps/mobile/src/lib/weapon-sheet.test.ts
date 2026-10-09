import { describe, expect, test } from 'bun:test'
import { PerkColumn, StatChange, WeaponPerk, WeaponSheet, WeaponStat } from '@ghost/contract'
import { canSwap, goodActive, rolledOnly, statBars, swapsOf, toggleStaged } from './weapon-sheet'

const perk = (
  plugHash: number,
  fields: {
    active?: boolean
    rolled?: boolean
    stats?: Record<string, number>
    good?: Array<'pve' | 'pvp'>
  },
) =>
  new WeaponPerk({
    name: `Perk ${plugHash}`,
    description: '',
    icon: null,
    plugHash,
    enhanced: false,
    active: fields.active ?? false,
    rolled: fields.rolled ?? fields.active ?? false,
    stats: Object.entries(fields.stats ?? {}).map(
      ([stat, value]) => new StatChange({ stat, value }),
    ),
    good: fields.good ?? [],
    source: null,
  })

const barrel = new PerkColumn({
  label: 'BARREL',
  socketIndex: 1,
  perks: [
    perk(10, { active: true, stats: { Range: 8, Stability: 6 }, good: ['pve'] }),
    perk(11, { rolled: true, stats: { Handling: 10, Range: -3 } }),
    perk(12, { stats: { Range: 12 } }),
  ],
})
const trait = new PerkColumn({
  label: 'TRAIT 1',
  socketIndex: 3,
  perks: [
    perk(30, { active: true, good: ['pve', 'pvp'] }),
    perk(31, { rolled: true, stats: { Range: 10 } }),
  ],
})
const sheet = new WeaponSheet({
  score: null,
  columns: [barrel, trait],
  stats: [
    new WeaponStat({ name: 'Range', value: 40, fromPerks: 18, bar: true }),
    new WeaponStat({ name: 'Handling', value: 95, fromPerks: 0, bar: true }),
    new WeaponStat({ name: 'RPM', value: 140, fromPerks: 0, bar: false }),
  ],
})

describe('toggleStaged', () => {
  test('stages a rolled perk, and a second tap or a tap on the active one takes it out', () => {
    const staged = toggleStaged(new Map(), barrel, barrel.perks[1]!)
    expect([...staged]).toEqual([[1, 11]])
    expect([...toggleStaged(staged, barrel, barrel.perks[1]!)]).toEqual([])
    expect([...toggleStaged(staged, barrel, barrel.perks[0]!)]).toEqual([])
  })

  test('never stages a perk this copy did not roll', () => {
    expect([...toggleStaged(new Map(), barrel, barrel.perks[2]!)]).toEqual([])
  })
})

describe('statBars', () => {
  test("previews what the staged swaps add and take, capped at the bar's end", () => {
    const swaps = swapsOf(
      sheet,
      new Map([
        [1, 11],
        [3, 31],
      ]),
    )
    const bars = statBars(sheet, swaps).map((bar) => [
      bar.name,
      bar.base,
      bar.perks,
      bar.gain,
      bar.loss,
      bar.delta,
    ])
    expect(bars).toEqual([
      ['Range', 22, 18, 0, 1, -1],
      ['Handling', 95, 0, 5, 0, 10],
    ])
  })
})

test('counts the active perks that are good for each purpose', () => {
  expect(goodActive(sheet, 'pve')).toEqual({ good: 2, of: 2 })
  expect(goodActive(sheet, 'pvp')).toEqual({ good: 1, of: 2 })
})

test('offers editing only when a rolled perk is out of its socket', () => {
  expect(canSwap(sheet)).toBe(true)
  const fixed = new WeaponSheet({
    ...sheet,
    columns: [new PerkColumn({ ...trait, perks: [trait.perks[0]!] })],
  })
  expect(canSwap(fixed)).toBe(false)
})

test("this copy's view keeps the socketed and rolled perks and drops the rest of the pool", () => {
  const names = rolledOnly(sheet).columns.map((column) => column.perks.map((each) => each.plugHash))
  expect(names).toEqual([
    [10, 11],
    [30, 31],
  ])
})
