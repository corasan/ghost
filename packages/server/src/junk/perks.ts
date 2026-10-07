import { perkKey } from "../wishlist/parse.ts"

export type Rating = "good" | "ok" | "junk"

/** Who rated a perk, strongest first: a player's rating beats Claude's, which beats the wishlist's. */
export type RatingSource = "player" | "claude" | "wishlist" | "community"

export interface RatedPerk {
  readonly name: string
  readonly rating: Rating
  /** null when nothing rates the perk, which makes it junk. */
  readonly source: RatingSource | null
}

export interface StoredRating {
  readonly rating: Rating
  readonly source: "player" | "claude"
}

/** What is known about one weapon's perks, keyed by perkKey. */
export interface PerkKnowledge {
  readonly stored: ReadonlyMap<string, StoredRating>
  /** Perks in this weapon's recommended wishlist rolls. */
  readonly wishlisted: ReadonlySet<string>
  /** Perks in this weapon's wishlist trash rolls. */
  readonly trashed: ReadonlySet<string>
  /** How many weapons the whole wishlist recommends each perk on. */
  readonly community: ReadonlyMap<string, number>
}

/** Weapons the whole wishlist must recommend a perk on for it to count as good or ok anywhere. */
export const COMMUNITY = { good: 50, ok: 20 } as const

const communityRating = (count: number): Rating =>
  count >= COMMUNITY.good ? "good" : count >= COMMUNITY.ok ? "ok" : "junk"

export const ratePerk = (name: string, known: PerkKnowledge): RatedPerk => {
  const key = perkKey(name)
  const stored = known.stored.get(key)
  if (stored !== undefined) return { name, ...stored }
  if (known.trashed.has(key)) return { name, rating: "junk", source: "wishlist" }
  if (known.wishlisted.has(key)) return { name, rating: "good", source: "wishlist" }
  const community = communityRating(known.community.get(key) ?? 0)
  if (community === "junk") return { name, rating: "junk", source: null }
  const capped = known.wishlisted.size > 0 ? "ok" : community
  return { name, rating: capped, source: "community" }
}

export type RatedColumns = ReadonlyArray<ReadonlyArray<RatedPerk>>

const valued = (perk: RatedPerk) => perk.rating !== "junk"

/** A roll is worth keeping with a good perk in some column, or ok perks in two. */
export const keepable = (columns: RatedColumns) =>
  columns.some((column) => column.some((perk) => perk.rating === "good")) ||
  columns.filter((column) => column.some(valued)).length >= 2

const keysOf = (column: ReadonlyArray<RatedPerk>) =>
  new Set(column.filter(valued).map((perk) => perkKey(perk.name)))

/** Every good or ok perk `inner` can slot, `outer` can slot in the same column. */
export const covers = (outer: RatedColumns, inner: RatedColumns) =>
  inner.every((column, index) => {
    const theirs = keysOf(outer[index] ?? [])
    return [...keysOf(column)].every((key) => theirs.has(key))
  })

/** Whether anything at all rates a perk this weapon can slot. */
export const rated = (columns: RatedColumns) =>
  columns.some((column) => column.some((perk) => perk.source !== null))
