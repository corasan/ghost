import { describe, expect, test } from 'bun:test'
import {
  checkRoll,
  dateIn,
  parseWishlist,
  recommendations,
  type StoredRoll,
  WILDCARD_ITEM,
} from './parse.ts'

const FIXTURE = `title:This is a compiled collection of god/recommended rolls.
description:Thanks to everyone.

// taken from https://example.com/ep174.txt

title:PvE Podcast 174 - The Best Machine Guns
description:Based on the 7 July 2026 @PodvsEnemies podcast.

// Archon's Thunder - PvE god
//notes:Constructed by @Adamsdown_Boy: first-choice PvE roll.|tags:PvE PvE-God M+KB Controller
dimwishlist:item=100&perks=1,2,3
dimwishlist:item=100&perks=1,2,4
dimwishlist:item=100&perks=5,6#notes:Inline note wins.|tags:pvp,mkb
dimwishlist:item=100&perks=7,8

// a comment ends the block notes
dimwishlist:item=-200&perks=9
dimwishlist:item=-69420&perks=10
dimwishlist:item=300
`

const parsed = parseWishlist(FIXTURE)

describe('parseWishlist', () => {
  test('parses rolls in order, with trash and wildcard items', () => {
    expect(parsed.rolls.map((r) => [r.itemHash, r.perkHashes.join(','), r.trash])).toEqual([
      [100, '1,2,3', false],
      [100, '1,2,4', false],
      [100, '5,6', false],
      [100, '7,8', false],
      [200, '9', true],
      [WILDCARD_ITEM, '10', false],
      [300, '', false],
    ])
  })

  test('block notes carry the section and split off tags; inline notes override', () => {
    const [first, , inline] = parsed.rolls.map((r) => parsed.blocks[r.block])
    expect(first).toEqual({
      notes: 'Constructed by @Adamsdown_Boy: first-choice PvE roll.',
      tags: ['PvE', 'PvE-God', 'M+KB', 'Controller'],
      sectionTitle: 'PvE Podcast 174 - The Best Machine Guns',
      sectionDescription: 'Based on the 7 July 2026 @PodvsEnemies podcast.',
      sectionUrl: 'https://example.com/ep174.txt',
      sectionDate: '2026-07-07',
    })
    expect(inline?.notes).toBe('Inline note wins.')
    expect(inline?.tags).toEqual(['pvp', 'mkb'])
    // Same notes share one block.
    expect(parsed.rolls[0]?.block).toBe(parsed.rolls[1]?.block)
  })

  test('block notes end at the first line that is not a roll', () => {
    const blockOf = (index: number) => {
      const roll = parsed.rolls[index]
      return roll === undefined ? undefined : parsed.blocks[roll.block]
    }
    expect(blockOf(3)?.notes).toBe('Constructed by @Adamsdown_Boy: first-choice PvE roll.')
    expect(blockOf(4)?.notes).toBeNull()
  })

  test('finds dates written either way', () => {
    expect(dateIn('the July 7, 2026 episode')).toBe('2026-07-07')
    expect(dateIn('no date here')).toBeNull()
  })
})

describe('checkRoll', () => {
  const stored = (hash: number): ReadonlyArray<StoredRoll> =>
    parsed.rolls
      .filter((r) => r.itemHash === hash || r.itemHash === WILDCARD_ITEM)
      .flatMap((r) => {
        const block = parsed.blocks[r.block]
        return block === undefined ? [] : [{ ...r, block }]
      })

  const names = new Map([
    [1, 'Rimestealer'],
    [2, 'Headstone'],
    [3, 'Tactical Mag'],
    [4, 'Alloy Mag'],
    [41, 'Alloy Mag'],
    [21, 'Enhanced Headstone'],
  ])
  const nameOf = (h: number) => names.get(h)

  test('a roll matches when every listed perk is on the item', () => {
    const check = checkRoll([1, 2, 3, 99], stored(100), nameOf)
    expect(check.full.map((m) => m.roll.perkHashes.join(','))).toEqual(['1,2,3'])
    expect(check.trash).toBe(false)
  })

  test('enhanced and alternate plug hashes match by name', () => {
    const check = checkRoll([1, 21, 41], stored(100), nameOf)
    expect(check.full.map((m) => m.roll.perkHashes.join(','))).toEqual(['1,2,4'])
  })

  test('partial matches are ranked by share of perks present', () => {
    const check = checkRoll([1, 7], stored(100), nameOf)
    expect(check.full).toEqual([])
    expect(check.partial.map((m) => `${m.matched}/${m.total}`)).toEqual(['1/2', '1/3', '1/3'])
  })

  test('trash rolls are flagged, wildcard rolls apply to any item', () => {
    expect(checkRoll([9], stored(200), nameOf).trash).toBe(true)
    expect(checkRoll([10], stored(500), nameOf).full).toHaveLength(1)
    expect(checkRoll([], stored(300), nameOf).full).toHaveLength(1)
  })

  test('recommendations group combos by curator note', () => {
    const recs = recommendations(stored(100), nameOf)
    expect(recs.map((r) => [r.notes, r.combos])).toEqual([
      ['Constructed by @Adamsdown_Boy: first-choice PvE roll.', 3],
      ['Inline note wins.', 1],
    ])
    expect(recs[0]?.perks.slice(0, 2)).toEqual(['Rimestealer', 'Headstone'])
  })
})
