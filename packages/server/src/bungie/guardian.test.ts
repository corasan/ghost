import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { Jev, JevUnavailable } from '../agent/jev.ts'
import { rankVault } from './guardian.ts'
import type { Inventory, OwnedItem } from './inventory.ts'

const owned = (id: string, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 1,
  name: `Item ${id}`,
  typeName: 'Hand Cannon',
  icon: null,
  tier: 'legendary',
  slot: 'energy',
  damageType: 'solar',
  power: 550,
  quantity: 1,
  location: 'vault',
  characterId: null,
  equipped: false,
  classType: null,
  locked: false,
  masterwork: false,
  statTotal: null,
  perks: [],
  duplicates: 0,
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

const inventory: Inventory = {
  membershipType: 3,
  membershipId: '1',
  characters: [],
  items: [
    owned('weak'),
    owned('best'),
    owned('good'),
    owned('carried', { location: 'character', characterId: 'c1' }),
  ],
  vaultCount: 3,
}

const FIT = new Map([
  ['weak', 0.2],
  ['best', 0.91],
  ['good', 0.637],
  ['carried', 0.99],
])

describe('rankVault', () => {
  test('ranks only vault items and keeps the fits, best first', () => {
    const asked: Array<{ intent: string; ids: ReadonlyArray<string> }> = []
    const jev = Layer.succeed(Jev, {
      rank: (intent, candidates) => {
        asked.push({ intent, ids: candidates.map((c) => c.id) })
        return Effect.succeed(new Map(candidates.map((c) => [c.id, FIT.get(c.id) ?? 0])))
      },
    })
    const found = Effect.runSync(
      rankVault(inventory, 'hand cannon that heals me').pipe(Effect.provide(jev)),
    )
    expect(asked).toEqual([{ intent: 'hand cannon that heals me', ids: ['weak', 'best', 'good'] }])
    expect(found.ranking).toBe('ranked')
    expect(found.matches.map((m) => [m.itemInstanceId, m.relevance])).toEqual([
      ['best', 0.91],
      ['good', 0.64],
    ])
  })

  test('says ranking is unavailable, with no matches, when Jev cannot answer', () => {
    const jev = Layer.succeed(Jev, {
      rank: () => Effect.fail(new JevUnavailable({ message: 'TYPESAFE_API_KEY is not set' })),
    })
    const found = Effect.runSync(rankVault(inventory, 'anything').pipe(Effect.provide(jev)))
    expect(found.ranking).toBe('unavailable')
    expect(found.matches).toEqual([])
  })
})
