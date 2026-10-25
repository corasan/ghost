import { describe, expect, test } from 'bun:test'
import type { Profile } from './inventory.ts'
import { BUCKETS, type ManifestItem } from './manifest.ts'
import { reconcile } from './writes.ts'

const TITAN = 'titan'
const weapon = (hash: number): ManifestItem => ({
  hash,
  name: `Weapon ${hash}`,
  typeName: 'Auto Rifle',
  icon: null,
  tier: 'legendary',
  slot: 'energy',
  damageType: 'solar',
  bucketHash: BUCKETS.energy,
  classType: 3,
  description: '',
})
const defs = new Map([
  [1, weapon(1)],
  [2, weapon(2)],
])
const raw = (hash: number, bucketHash: number) => ({
  itemHash: hash,
  itemInstanceId: `i${hash}`,
  quantity: 1,
  bucketHash,
})

const profile = (
  vault: ReadonlyArray<ReturnType<typeof raw>>,
  carried: ReadonlyArray<ReturnType<typeof raw>>,
  worn: ReadonlyArray<ReturnType<typeof raw>>,
): Profile => ({
  profileInventory: { data: { items: vault } },
  characterInventories: { data: { [TITAN]: { items: carried } } },
  characterEquipment: { data: { [TITAN]: { items: worn } } },
})

const where = (p: Profile) => ({
  vault: p.profileInventory?.data?.items.map((each) => each.itemInstanceId),
  carried: p.characterInventories?.data?.[TITAN]?.items.map((each) => each.itemInstanceId),
  worn: p.characterEquipment?.data?.[TITAN]?.items.map((each) => each.itemInstanceId),
})

describe('reconcile', () => {
  test('equipping out of the vault puts the old weapon in the inventory', () => {
    const before = profile([raw(1, BUCKETS.vault)], [], [raw(2, BUCKETS.energy)])
    const after = reconcile(
      before,
      [
        { kind: 'move', itemId: 'i1', to: TITAN },
        { kind: 'equip', itemId: 'i1', characterId: TITAN },
      ],
      defs,
    )
    expect(where(after)).toEqual({ vault: [], carried: ['i2'], worn: ['i1'] })
  })

  test('leaves a profile that already shows the writes as it is', () => {
    const caughtUp = profile([], [raw(2, BUCKETS.energy)], [raw(1, BUCKETS.energy)])
    const after = reconcile(
      caughtUp,
      [
        { kind: 'move', itemId: 'i1', to: TITAN },
        { kind: 'equip', itemId: 'i1', characterId: TITAN },
      ],
      defs,
    )
    expect(where(after)).toEqual(where(caughtUp))
  })
})
