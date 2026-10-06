// DIM wishlist format, as used by voltron.txt. The file is a concatenation
// of curator sections:
//
//   // taken from <url>
//   title:<section title>
//   description:<credits, often with the podcast or article date>
//   //notes:<why these rolls are good>|tags:PvE M+KB ...
//   dimwishlist:item=<hash>&perks=<plug hash>,<plug hash>,...
//   dimwishlist:item=<hash>&perks=...#notes:<overrides the block notes>
//
// `item=-<hash>` marks a trash roll and `item=-69420` matches any item. Block
// notes apply to the roll lines right after them and end at the first line
// that is not a roll. Notes are shared by hundreds of lines, so they are
// returned once per block and rolls point at their block.

export const WILDCARD_ITEM = -69420

export interface WishlistBlock {
  readonly notes: string | null
  readonly tags: ReadonlyArray<string>
  readonly sectionTitle: string | null
  readonly sectionDescription: string | null
  readonly sectionUrl: string | null
  /** ISO date found in the section description, e.g. a podcast date. */
  readonly sectionDate: string | null
}

export interface WishlistRoll {
  /** Positive item hash, or WILDCARD_ITEM. */
  readonly itemHash: number
  readonly perkHashes: ReadonlyArray<number>
  readonly trash: boolean
  readonly block: number
}

export interface ParsedWishlist {
  readonly blocks: ReadonlyArray<WishlistBlock>
  readonly rolls: ReadonlyArray<WishlistRoll>
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]

const pad = (n: number) => String(n).padStart(2, "0")

/** "7 July 2026" or "July 7, 2026" → "2026-07-07"; the last date mentioned wins. */
export const dateIn = (text: string): string | null => {
  const months = MONTHS.join("|")
  const patterns = [
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${months}),? (\\d{4})\\b`, "gi"),
    new RegExp(`\\b(${months}) (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "gi"),
  ]
  let found: { index: number; iso: string } | null = null
  for (const [i, pattern] of patterns.entries()) {
    for (const m of text.matchAll(pattern)) {
      const [day, month, year] = i === 0 ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]]
      const monthIndex = MONTHS.indexOf((month ?? "").toLowerCase())
      if (monthIndex < 0 || day === undefined || year === undefined) continue
      if (found === null || m.index > found.index) {
        found = { index: m.index, iso: `${year}-${pad(monthIndex + 1)}-${pad(Number(day))}` }
      }
    }
  }
  return found?.iso ?? null
}

/** Splits "text|tags:PvE M+KB,controller" into the text and its tags. */
export const splitNotes = (raw: string) => {
  const at = raw.indexOf("|tags:")
  const text = (at < 0 ? raw : raw.slice(0, at)).trim()
  const tags =
    at < 0
      ? []
      : raw
          .slice(at + 6)
          .split(/[\s,]+/)
          .filter((t) => t !== "")
  return { notes: text === "" ? null : text, tags }
}

const parseRoll = (line: string) => {
  const hashAt = line.indexOf("#notes:")
  const body = hashAt < 0 ? line : line.slice(0, hashAt)
  const params = new URLSearchParams(body.slice("dimwishlist:".length))
  const item = Number(params.get("item"))
  if (!Number.isInteger(item) || item === 0) return undefined
  const perkHashes = (params.get("perks") ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  const trash = item < 0 && item !== WILDCARD_ITEM
  return {
    itemHash: trash ? -item : item,
    perkHashes,
    trash,
    inlineNotes: hashAt < 0 ? undefined : line.slice(hashAt + "#notes:".length),
  }
}

interface Section {
  readonly title: string | null
  readonly description: string | null
  readonly url: string | null
  readonly date: string | null
}

export const parseWishlist = (text: string): ParsedWishlist => {
  const blocks: Array<WishlistBlock> = []
  const blockIds = new Map<string, number>()
  const rolls: Array<WishlistRoll> = []

  let section: Section = { title: null, description: null, url: null, date: null }
  let pendingUrl: string | null = null
  let blockNotes: string | null = null

  const blockFor = (rawNotes: string | null) => {
    const { notes, tags } = rawNotes === null ? { notes: null, tags: [] } : splitNotes(rawNotes)
    const key = `${section.title}\u0000${section.url}\u0000${notes}\u0000${tags.join(" ")}`
    const existing = blockIds.get(key)
    if (existing !== undefined) return existing
    blocks.push({
      notes,
      tags,
      sectionTitle: section.title,
      sectionDescription: section.description,
      sectionUrl: section.url,
      sectionDate: section.date,
    })
    blockIds.set(key, blocks.length - 1)
    return blocks.length - 1
  }

  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("dimwishlist:")) {
      const roll = parseRoll(line)
      if (roll === undefined) continue
      const block = blockFor(roll.inlineNotes ?? blockNotes)
      rolls.push({ itemHash: roll.itemHash, perkHashes: roll.perkHashes, trash: roll.trash, block })
      continue
    }
    if (line.startsWith("//notes:")) {
      blockNotes = line.slice("//notes:".length)
      continue
    }
    blockNotes = null
    if (line.startsWith("// taken from ")) {
      pendingUrl = line.slice("// taken from ".length).trim()
    } else if (line.startsWith("title:")) {
      section = { title: line.slice(6).trim(), description: null, url: pendingUrl, date: null }
      pendingUrl = null
    } else if (line.startsWith("description:")) {
      const description = line.slice(12).trim()
      section = { ...section, description, date: dateIn(description) }
    }
  }
  return { blocks, rolls }
}

// ---- Matching a player's roll ----

/** Enhanced perks share the base perk's name, sometimes with an "Enhanced " prefix. */
export const perkKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/^enhanced /, "")
    .trim()

export interface StoredRoll {
  readonly itemHash: number
  readonly perkHashes: ReadonlyArray<number>
  readonly trash: boolean
  readonly block: WishlistBlock
}

export interface RollMatch {
  readonly roll: StoredRoll
  readonly matched: number
  readonly total: number
  readonly full: boolean
}

export interface RollCheck {
  /** Rolls whose perks are all on the item, in file order (first is DIM's pick). */
  readonly full: ReadonlyArray<RollMatch>
  /** Best partial matches, most perks in common first. */
  readonly partial: ReadonlyArray<RollMatch>
  readonly trash: boolean
}

// A wishlist roll matches when every perk it lists is among the item's
// plugs. Plugs are compared by hash and by normalized name, which is how an
// Enhanced perk on the player's copy still matches the base perk listed.
export const perkMatcher = (
  plugHashes: ReadonlyArray<number>,
  nameOf: (hash: number) => string | undefined,
) => {
  const hashes = new Set(plugHashes)
  const names = new Set(
    plugHashes.flatMap((h) => {
      const name = nameOf(h)
      return name === undefined ? [] : [perkKey(name)]
    }),
  )
  return (hash: number) => {
    if (hashes.has(hash)) return true
    const name = nameOf(hash)
    return name !== undefined && names.has(perkKey(name))
  }
}

export const checkRoll = (
  plugHashes: ReadonlyArray<number>,
  rolls: ReadonlyArray<StoredRoll>,
  nameOf: (hash: number) => string | undefined,
  partialLimit = 5,
): RollCheck => {
  const has = perkMatcher(plugHashes, nameOf)
  const full: Array<RollMatch> = []
  const partial: Array<RollMatch> = []
  for (const roll of rolls) {
    const matched = roll.perkHashes.filter(has).length
    const total = roll.perkHashes.length
    const match = { roll, matched, total, full: matched === total }
    if (match.full) full.push(match)
    // Wildcard rolls are generic advice, only worth reporting on a full match.
    else if (matched > 0 && !roll.trash && roll.itemHash !== WILDCARD_ITEM) partial.push(match)
  }
  partial.sort((a, b) => b.matched / b.total - a.matched / a.total || b.matched - a.matched)
  return {
    full,
    partial: partial.slice(0, partialLimit),
    trash: full.some((m) => m.roll.trash),
  }
}

export interface Recommendation {
  readonly notes: string | null
  readonly tags: ReadonlyArray<string>
  readonly sectionTitle: string | null
  readonly sectionUrl: string | null
  readonly sectionDate: string | null
  /** Each listed perk, most often recommended first. */
  readonly perks: ReadonlyArray<string>
  readonly combos: number
}

// voltron spells every combination out as its own line, so the useful view
// is one entry per curator note with the perks it keeps coming back to.
export const recommendations = (
  rolls: ReadonlyArray<StoredRoll>,
  nameOf: (hash: number) => string | undefined,
  limit = 15,
): ReadonlyArray<Recommendation> => {
  const groups = new Map<WishlistBlock, { counts: Map<string, number>; combos: number }>()
  for (const roll of rolls) {
    if (roll.trash || roll.itemHash === WILDCARD_ITEM) continue
    const group = groups.get(roll.block) ?? { counts: new Map(), combos: 0 }
    group.combos += 1
    for (const hash of roll.perkHashes) {
      const name = nameOf(hash) ?? `#${hash}`
      group.counts.set(name, (group.counts.get(name) ?? 0) + 1)
    }
    groups.set(roll.block, group)
  }
  return [...groups.entries()].slice(0, limit).map(([block, group]) => ({
    notes: block.notes,
    tags: block.tags,
    sectionTitle: block.sectionTitle,
    sectionUrl: block.sectionUrl,
    sectionDate: block.sectionDate,
    perks: [...group.counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    combos: group.combos,
  }))
}

// A full curated match is the strongest signal; "god" tags mark the
// curator's top pick. Partial matches scale with how many listed perks the
// roll has, and a trash match overrides everything.
export const scoreFor = (
  full: ReadonlyArray<RollMatch>,
  partial: ReadonlyArray<RollMatch>,
  rolls: number,
) => {
  if (full.some((m) => m.roll.trash)) return { score: 10, basis: "matches a wishlist trash roll" }
  const keepers = full.filter((m) => !m.roll.trash)
  if (keepers.some((m) => m.roll.block.tags.some((t) => /god/i.test(t)))) {
    return { score: 95, basis: "fully matches a wishlist roll tagged god" }
  }
  if (keepers.length > 0) return { score: 85, basis: "fully matches a wishlist roll" }
  const best = partial[0]
  if (best !== undefined) {
    return {
      score: Math.round(40 + (40 * best.matched) / best.total),
      basis: `has ${best.matched} of ${best.total} perks of the closest wishlist roll`,
    }
  }
  if (rolls > 0) return { score: 30, basis: "has none of the wishlist's recommended perks" }
  return { score: null, basis: "the wishlist has no entries for this weapon" }
}

/** A weapon's trait perks, each good when the best wishlist roll it matches lists it, and its suggested score. */
export const judgeWeapon = (
  item: { readonly perks: ReadonlyArray<string>; readonly plugHashes: ReadonlyArray<number> },
  rolls: ReadonlyArray<StoredRoll>,
  nameOf: (hash: number) => string | undefined,
) => {
  const check = checkRoll(item.plugHashes, rolls, nameOf)
  const best = check.full.find((match) => !match.roll.trash) ?? check.partial[0]
  const listed = new Set(
    (best?.roll.perkHashes ?? []).flatMap((hash) => {
      const name = nameOf(hash)
      return name === undefined ? [] : [perkKey(name)]
    }),
  )
  return {
    perks: item.perks.map((name) => ({ name, good: listed.has(perkKey(name)) })),
    score: scoreFor(check.full, check.partial, rolls.length).score,
  }
}
