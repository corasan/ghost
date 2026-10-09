import { describe, expect, test } from 'bun:test'
import type { OwnedItem } from '../bungie/inventory.ts'
import type { Verdict } from './judge.ts'
import { cleanupRows, flagged, reviewItems } from './proposal.ts'
import type { Judgment } from './service.ts'

const weapon = (id: string, name: string, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 1,
  name,
  typeName: 'Hand Cannon',
  icon: null,
  tier: 'legendary',
  slot: 'kinetic',
  damageType: 'kinetic',
  power: 1990,
  quantity: 1,
  location: 'vault',
  characterId: null,
  equipped: false,
  classType: null,
  locked: false,
  masterwork: false,
  statTotal: null,
  perks: [],
  duplicates: 1,
  decision: null,
  acquiredAt: null,
  armorStats: null,
  plugHashes: [],
  modSockets: [],
  weaponSockets: [],
  weaponStats: {},
  energy: null,
  exoticPerk: null,
  intrinsics: [],
  set: null,
  crafted: false,
  tuning: null,
  traits: [],
  ...fields,
})

const judgment: Judgment = {
  items: new Map(
    [
      weapon('keeper', 'Fatebringer'),
      weapon('dupe', 'Fatebringer', { power: 1980 }),
      weapon('trash', 'Ammit AR2'),
      weapon('locked', 'Fatebringer', { locked: true }),
      weapon('ghost', 'Ghost Shell', { slot: 'other' }),
    ].map((item) => [item.itemInstanceId, item]),
  ),
  verdicts: new Map<string, Verdict>([
    ['keeper', { verdict: 'keep', protections: ['best_copy'] }],
    ['dupe', { verdict: 'junk', signals: [{ kind: 'duplicate', better: 'keeper', shared: [] }] }],
    [
      'trash',
      {
        verdict: 'review',
        signals: [{ kind: 'trash_roll', score: 10 }],
        why: 'your only copy',
      },
    ],
    ['locked', { verdict: 'keep', protections: ['locked'] }],
  ]),
  columns: new Map(),
}

describe('flagged', () => {
  test('lists junk then review, and never a kept item', () => {
    expect(flagged(judgment).map((f) => [f.item.itemInstanceId, f.verdict])).toEqual([
      ['dupe', 'junk'],
      ['trash', 'review'],
    ])
  })

  test('says DUPLICATE for duplicates only, which is how the app sorts DUPES from LOW ROLL', () => {
    const reasons = new Map(flagged(judgment).map((f) => [f.item.itemInstanceId, f.reason]))
    expect(reasons.get('dupe')).toBe('Duplicate of Fatebringer 1990')
    expect(reasons.get('trash')).not.toMatch(/duplicate/i)
  })
})

describe('cleanupRows', () => {
  test('ticks junk, leaves review unticked, and writes the reason itself', () => {
    expect(
      cleanupRows(judgment, [
        { itemInstanceId: 'dupe', action: 'tag_junk' },
        { itemInstanceId: 'trash', action: 'tag_junk' },
      ]),
    ).toEqual({
      rows: [
        {
          itemInstanceId: 'dupe',
          action: 'tag_junk',
          meta: 'Duplicate of Fatebringer 1990',
          selected: true,
        },
        {
          itemInstanceId: 'trash',
          action: 'tag_junk',
          meta: 'Trash roll · 10/100 · review: your only copy',
          selected: false,
        },
      ],
    })
  })

  test('refuses a protected item and names the protection', () => {
    expect(
      cleanupRows(judgment, [
        { itemInstanceId: 'dupe', action: 'tag_junk' },
        { itemInstanceId: 'locked', action: 'tag_junk' },
      ]),
    ).toEqual({ errors: ['Fatebringer (locked) cannot be tagged junk: it is locked'] })
  })

  test('refuses rows the judgment never flagged', () => {
    const result = cleanupRows(judgment, [
      { itemInstanceId: 'keeper', action: 'tag_junk' },
      { itemInstanceId: 'ghost', action: 'tag_junk' },
      { itemInstanceId: 'nope', action: 'tag_junk' },
      { itemInstanceId: 'dupe', action: 'to_vault' },
    ])
    expect('errors' in result && result.errors.length).toBe(4)
  })
})

describe('reviewItems', () => {
  test('lists only review rows, with the whole reason, until the player decides', () => {
    const undecided = reviewItems(judgment, () => false)
    expect(undecided.map((r) => [r.itemInstanceId, r.meta, r.reason])).toEqual([
      ['trash', 'Hand Cannon · 1990', 'Trash roll · 10/100 · review: your only copy'],
    ])
    expect(reviewItems(judgment, (id) => id === 'trash')).toEqual([])
  })
})

test('names the tiers when a higher-tier copy is the better one', () => {
  const items = new Map(
    [
      weapon('t4', 'Fatebringer', { gearTier: 4 }),
      weapon('t5', 'Fatebringer', { gearTier: 5 }),
    ].map((item) => [item.itemInstanceId, item]),
  )
  const [row] = flagged({
    items,
    verdicts: new Map<string, Verdict>([
      ['t4', { verdict: 'junk', signals: [{ kind: 'duplicate', better: 't5', shared: [] }] }],
      ['t5', { verdict: 'keep', protections: ['best_copy'] }],
    ]),
    columns: new Map(),
  })
  expect(row?.reason).toBe('Duplicate of Fatebringer 1990 · tier 4 vs 5')
})
