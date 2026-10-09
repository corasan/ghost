import { describe, expect, test } from 'bun:test'
import { STAT } from './inventory.ts'
import { describeLoadout } from './loadout.ts'

describe('describeLoadout', () => {
  const plug = (hash: number, name: string, description = '') => ({
    hash,
    name,
    description,
    icon: null,
  })
  const loadout = describeLoadout({
    character: {
      classType: 'titan',
      subclass: 'Sunbreaker',
      subclassIcon: null,
      element: 'solar',
      loadout: {
        super: plug(9, 'Hammer of Sol', 'Throw hammers.'),
        abilities: [{ ...plug(8, 'Rally Barricade'), kind: 'class' }],
        aspects: [plug(3, 'Sol Invictus')],
        fragments: [plug(1, 'Ember of Searing'), plug(2, 'Ember of Solace')],
      },
    },
    plugs: new Map([
      [
        1,
        {
          mods: { [STAT.mobility]: 10 },
          classMods: { [STAT.resilience]: -10, [STAT.recovery]: -10 },
          fragmentSlots: 0,
          energyCost: 0,
          category: '',
          artifact: false,
          charged: false,
          keywords: [],
          description: '',
        },
      ],
      [
        3,
        {
          mods: {},
          classMods: {},
          fragmentSlots: 2,
          energyCost: 0,
          category: '',
          artifact: false,
          charged: false,
          keywords: [],
          description: 'Kills leave Sunspots.',
        },
      ],
    ]),
    facts: { [STAT.mobility]: { name: 'Weapons', effect: '' } },
  })

  test("a class penalty lands only on that class's stat, under the label the stats use", () => {
    expect(loadout.fragments.map((f) => f.mods.map((m) => [m.label, m.delta]))).toEqual([
      [
        ['HEALTH', -10],
        ['WEAPONS', 10],
      ],
      [],
    ])
  })

  test('an aspect gets its slots and the effect text its item definition lacks', () => {
    expect(loadout.aspects[0]).toMatchObject({
      description: 'Kills leave Sunspots.',
      fragmentSlots: 2,
    })
    expect(loadout.super?.description).toBe('Throw hammers.')
    expect(loadout.fragments[0]?.fragmentSlots).toBeUndefined()
  })
})
