// The "Set Bonuses" tab of Aegis's "Destiny 2: Endgame Analysis" sheet, as
// its CSV export. A banner row sits above the header, and there is one row
// per set bonus, not per set:
//
//   INFO,,,,,,,,,ANALYSIS,,
//   🖼️,#,Set,Season,Bonus,Pcs,Tags,Trigger,Effect,Description,#,Tier
//   ,,"Atheon's Memory\nVault of Glass",29,Collective Power,4,damage,...,1,S
//
// Set is the set name, then where it drops on the next line; Tags, Trigger
// and Effect hold one entry per line. The first # is an image reference and
// the # after Description is the overall rank. Columns are found by header
// name so a reordered sheet still parses and a renamed one is noticed.

export const RATING_TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const
export type RatingTier = (typeof RATING_TIERS)[number]

export interface SetBonusRating {
  /** First line of the Set cell. */
  readonly set: string
  /** The rest of the Set cell: where the set drops. */
  readonly source: string | null
  readonly season: number | null
  readonly bonus: string
  readonly pieces: number
  /** As written, e.g. damage, survivability, PvP; compare case-insensitively. */
  readonly tags: ReadonlyArray<string>
  readonly trigger: string
  readonly effect: string
  /** The sheet's Description column: why the bonus is rated where it is. */
  readonly analysis: string
  /** Overall rank across every bonus, 1 is best. */
  readonly rank: number
  readonly tier: RatingTier
}

/** RFC 4180: quoted cells, "" for a quote, line breaks inside quotes, CRLF or LF rows. */
export const parseCsv = (text: string): ReadonlyArray<ReadonlyArray<string>> => {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') cell += c
      else if (text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** Join key for set and bonus names: case, curly apostrophes and spacing ignored. */
export const ratingKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const REQUIRED = ['Set', 'Bonus', 'Pcs', 'Tier'] as const
const COLUMNS = ['Season', 'Tags', 'Trigger', 'Effect', 'Description'] as const

const lines = (cell: string) =>
  cell
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const numberOr = <A>(cell: string, fallback: A) => {
  const n = Number(cell.trim())
  return cell.trim() === '' || !Number.isFinite(n) ? fallback : n
}

const isTier = (cell: string): cell is RatingTier => RATING_TIERS.some((tier) => tier === cell)

export const parseSetRatings = (csv: string): ReadonlyArray<SetBonusRating> => {
  const rows = parseCsv(csv)
  const headerAt = rows.findIndex((row) =>
    REQUIRED.every((name) => row.some((cell) => cell.trim() === name)),
  )
  if (headerAt === -1) {
    throw new Error(`set ratings sheet: no header row with ${REQUIRED.join(', ')}`)
  }
  const header = rows[headerAt]!.map((cell) => cell.trim())
  const column = (name: string, from = 0) => header.indexOf(name, from)
  const missing = [...REQUIRED, ...COLUMNS].filter((name) => column(name) === -1)
  const rankAt = column('#', column('Description') + 1)
  if (missing.length > 0 || rankAt === -1) {
    throw new Error(
      `set ratings sheet: missing column(s) ${[...missing, ...(rankAt === -1 ? ['# (rank)'] : [])].join(', ')}`,
    )
  }
  const at = (row: ReadonlyArray<string>, name: string) => row[column(name)] ?? ''

  return rows.slice(headerAt + 1).flatMap((row): ReadonlyArray<SetBonusRating> => {
    const bonus = at(row, 'Bonus').trim()
    const tier = at(row, 'Tier').trim().toUpperCase()
    const rank = numberOr(row[rankAt] ?? '', null)
    const pieces = numberOr(at(row, 'Pcs'), null)
    if (bonus === '' || !isTier(tier) || rank === null || pieces === null) return []
    const [set = '', ...source] = lines(at(row, 'Set'))
    return [
      {
        set,
        source: source.length > 0 ? source.join(', ') : null,
        season: numberOr(at(row, 'Season'), null),
        bonus,
        pieces,
        tags: lines(at(row, 'Tags')),
        trigger: at(row, 'Trigger').trim(),
        effect: at(row, 'Effect').trim(),
        analysis: at(row, 'Description').trim(),
        rank,
        tier,
      },
    ]
  })
}
