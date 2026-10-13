import { describe, expect, test } from 'bun:test'
import { parseCsv, parseSetRatings, ratingKey } from './parse.ts'

// Rows copied from the sheet's CSV export, CRLF line ends included.
const FIXTURE = [
  'INFO,,,,,,,,,ANALYSIS,,',
  '🖼️,#,Set,Season,Bonus,Pcs,Tags,Trigger,Effect,Description,#,Tier',
  `,,"Atheon's Memory
Vault of Glass",29,Collective Power,4,damage,5 damage instances with subclass buff active,Orb of Power at feet (effective 5s ICD),"exclusive effect, great for extra super, Still Hunt, Argent mod facilitation, essentially Attrition Orbs without any setup",1,S`,
  `,,"CODA
Prophecy",29,So Very Thin,4,"ability
survivability","Light weapon kills
Dark or kinetic weapon kills
alternating weapon kills within ?s","22?% grenade energy
22?% melee energy
40% DR for 5s, refreshable on kill","easily the most consistent source of high DR if able to play around swapping polarities, excellent chunk gains too",5,S`,
  `,9,"Smoke Jumper
Solo/Fireteam Ops",27,"Ride Together, Die Together",2,survivability,orb pickup,40% DR decaying for 3s,"excellent pairing with Attrition Orbs / triple arm orb gen mod setups, a little build-dependent but solid regardless",6,A`,
  `,22,"Twofold Crown
Trials of Osiris",27,Gift of Sight,4,PvP,primary kill,enhanced radar for 5s,does literally nothing in PvE,112,F`,
  ',,,,,,,,,,,',
].join('\r\n')

describe('parseCsv', () => {
  test('a doubled quote inside a quoted cell is one quote', () => {
    expect(parseCsv('a,"say ""hi""",b\n')).toEqual([['a', 'say "hi"', 'b']])
  })
})

describe('parseSetRatings', () => {
  const ratings = parseSetRatings(FIXTURE)

  test('reads one rating per bonus row below the banner, skipping empty rows', () => {
    expect(ratings.map((r) => r.bonus)).toEqual([
      'Collective Power',
      'So Very Thin',
      'Ride Together, Die Together',
      'Gift of Sight',
    ])
  })

  test('splits the Set cell into the set name and where it drops', () => {
    expect(ratings.map((r) => [r.set, r.source])).toEqual([
      ["Atheon's Memory", 'Vault of Glass'],
      ['CODA', 'Prophecy'],
      ['Smoke Jumper', 'Solo/Fireteam Ops'],
      ['Twofold Crown', 'Trials of Osiris'],
    ])
  })

  test('takes rank from the # after Description, not the image #', () => {
    expect(ratings.map((r) => [r.rank, r.tier])).toEqual([
      [1, 'S'],
      [5, 'S'],
      [6, 'A'],
      [112, 'F'],
    ])
  })

  test('keeps multi-line cells: tags as a list, trigger and effect as text', () => {
    const coda = ratings[1]!
    expect(coda.tags).toEqual(['ability', 'survivability'])
    expect(coda.pieces).toBe(4)
    expect(coda.season).toBe(29)
    expect(coda.trigger).toBe(
      'Light weapon kills\nDark or kinetic weapon kills\nalternating weapon kills within ?s',
    )
    expect(coda.analysis).toStartWith('easily the most consistent source of high DR')
  })

  test('a sheet without a Tier column is rejected', () => {
    const renamedTier = FIXTURE.replace(',#,Tier', ',#,Grade')
    expect(() => parseSetRatings(renamedTier)).toThrow(/Tier/)
  })

  test('a page that is not the sheet is rejected', () => {
    expect(() => parseSetRatings('<!doctype html><html><body>Sign in</body></html>')).toThrow()
  })
})

test('ratingKey ignores case, curly apostrophes and spacing', () => {
  expect(ratingKey('  Atheon’s   MEMORY ')).toBe(ratingKey("Atheon's Memory"))
})
