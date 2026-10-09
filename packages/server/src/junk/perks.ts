import { perkKey } from "../wishlist/parse.ts"

export type Rating = "good" | "ok" | "junk"

export type Purpose = "pve" | "pvp"

export const PURPOSES: ReadonlyArray<Purpose> = ["pve", "pvp"]

/** Who rated a perk, strongest first: a player's rating beats Claude's, which beats the wishlist's. */
export type RatingSource = "player" | "claude" | "wishlist" | "community"

export interface RatedPerk {
  readonly name: string
  /** The best it rates for any purpose. */
  readonly rating: Rating
  /** The purposes it is good for. */
  readonly good: ReadonlyArray<Purpose>
  /** null when nothing rates the perk, which makes it junk. */
  readonly source: RatingSource | null
}

export interface StoredRating {
  readonly rating: Rating
  readonly source: "player" | "claude"
  /** "any" rates the perk for PvE and PvP alike. */
  readonly purpose: Purpose | "any"
}

/** What is known about one weapon's perks, keyed by perkKey. */
export interface PerkKnowledge {
  readonly stored: ReadonlyMap<string, ReadonlyArray<StoredRating>>
  /** How many of this weapon's recommended wishlist rolls for each purpose name each perk. */
  readonly wishlisted: Readonly<Record<Purpose, ReadonlyMap<string, number>>>
  /** Perks in this weapon's wishlist trash rolls. */
  readonly trashed: ReadonlySet<string>
  /** How many weapons the whole wishlist recommends each perk on. */
  readonly community: ReadonlyMap<string, number>
}

/** Weapons the whole wishlist must recommend a perk on for it to count as good or ok anywhere. */
export const COMMUNITY = { good: 150, ok: 75 } as const

/**
 * A perk is good on a weapon when its wishlist rolls name it at least this
 * share as often as the column's most named perk. Curators list every perk
 * they would accept, so naming alone only makes a perk ok.
 */
export const WISHLIST_GOOD = 0.6

const RANK: Record<Rating, number> = { junk: 0, ok: 1, good: 2 }

const communityRating = (count: number): Rating =>
  count >= COMMUNITY.good ? "good" : count >= COMMUNITY.ok ? "ok" : "junk"

interface Judged {
  readonly rating: Rating
  readonly source: RatingSource | null
}

const storedFor = (rows: ReadonlyArray<StoredRating>, purpose: Purpose) => {
  // The player's rating wins over Claude's, and one for this purpose over
  // one for any, whatever order the rows came back in.
  const rank = (row: StoredRating) =>
    (row.source === "player" ? 0 : 2) + (row.purpose === "any" ? 1 : 0)
  return rows
    .filter((row) => row.purpose === purpose || row.purpose === "any")
    .toSorted((a, b) => rank(a) - rank(b))[0]
}

// A curated list names a weapon's good perks, so anything it leaves out is
// at best ok, and the same goes for the weapon's own wishlist over the
// community count.
const rateFor = (
  key: string,
  known: PerkKnowledge,
  purpose: Purpose,
  columnTop: number,
): Judged => {
  const stored = storedFor(known.stored.get(key) ?? [], purpose)
  if (stored !== undefined) return { rating: stored.rating, source: stored.source }
  if (known.trashed.has(key)) return { rating: "junk", source: "wishlist" }
  const curated = known.stored.size > 0
  const wishlisted = known.wishlisted[purpose]
  const named = wishlisted.get(key) ?? 0
  if (named > 0) {
    const good = !curated && named >= WISHLIST_GOOD * columnTop
    return { rating: good ? "good" : "ok", source: "wishlist" }
  }
  const community = communityRating(known.community.get(key) ?? 0)
  if (community === "junk") return { rating: "junk", source: null }
  const ownList = known.wishlisted.pve.size > 0 || known.wishlisted.pvp.size > 0
  return { rating: curated || ownList ? "ok" : community, source: "community" }
}

/** `columnTops` is, per purpose, how many rolls name the column's most named perk on this weapon. */
export const ratePerk = (
  name: string,
  known: PerkKnowledge,
  columnTops: Readonly<Record<Purpose, number>>,
): RatedPerk => {
  const key = perkKey(name)
  const judged = PURPOSES.map((purpose) => ({
    purpose,
    ...rateFor(key, known, purpose, columnTops[purpose]),
  }))
  const best = judged.reduce((a, b) => (RANK[b.rating] > RANK[a.rating] ? b : a))
  return {
    name,
    rating: best.rating,
    good: judged.filter((each) => each.rating === "good").map((each) => each.purpose),
    source: best.source,
  }
}

export type RatedColumns = ReadonlyArray<ReadonlyArray<RatedPerk>>

/** A roll is worth keeping with a good perk in some column, or ok perks in two. */
export const keepable = (columns: RatedColumns) =>
  columns.some((column) => column.some((perk) => perk.rating === "good")) ||
  columns.filter((column) => column.some((perk) => perk.rating !== "junk")).length >= 2

/** How many columns can slot a perk that is good for `purpose`. */
export const goodColumns = (columns: RatedColumns, purpose: Purpose) =>
  columns.filter((column) => column.some((perk) => perk.good.includes(purpose))).length

/** Whether anything at all rates a perk this weapon can slot. */
export const rated = (columns: RatedColumns) =>
  columns.some((column) => column.some((perk) => perk.source !== null))
