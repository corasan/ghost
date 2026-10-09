import type { DamageType, GuardianClass, ItemSummary, ItemTier } from '@ghost/contract'

// Vault filtering runs on the phone over the cached snapshot: a few hundred
// items filter in well under a frame, so typing and tapping chips never wait
// on the network. Pure functions so they can be tested with `bun test`.

export type Category = 'all' | 'weapons' | 'armor'
const FLAGS = ['dupes', 'junk', 'unlocked', 'new'] as const
export type Flag = (typeof FLAGS)[number]
export type Sort = 'power' | 'newest' | 'stats' | 'name'

export interface VaultFilter {
  readonly query: string
  readonly category: Category
  readonly tiers: ReadonlySet<ItemTier>
  readonly elements: ReadonlySet<DamageType>
  readonly classes: ReadonlySet<GuardianClass>
  readonly flags: ReadonlySet<Flag>
  readonly sort: Sort
}

export const emptyFilter: VaultFilter = {
  query: '',
  category: 'all',
  tiers: new Set(),
  elements: new Set(),
  classes: new Set(),
  flags: new Set(),
  sort: 'power',
}

const WEAPON_SLOTS = new Set(['kinetic', 'energy', 'power'])
const ARMOR_SLOTS = new Set(['helmet', 'arms', 'chest', 'legs', 'class'])

export const isWeapon = (item: ItemSummary) => WEAPON_SLOTS.has(item.slot)
export const isArmor = (item: ItemSummary) => ARMOR_SLOTS.has(item.slot)

const NEW_WINDOW_MS = 48 * 60 * 60 * 1000

// The lowercase search text is built once per item object, not per keystroke.
const haystacks = new WeakMap<ItemSummary, string>()
const haystack = (item: ItemSummary) => {
  let text = haystacks.get(item)
  if (text === undefined) {
    text = [item.name, item.typeName, item.damageType, item.slot, ...item.perks]
      .join(' ')
      .toLowerCase()
    haystacks.set(item, text)
  }
  return text
}

const matchesFlag = (item: ItemSummary, flag: Flag, now: number) => {
  switch (flag) {
    case 'dupes':
      return item.duplicates > 0
    case 'junk':
      return item.decision === 'junk'
    case 'unlocked':
      return !item.locked
    case 'new':
      return item.acquiredAt !== null && now - Date.parse(item.acquiredAt) < NEW_WINDOW_MS
  }
}

const inCategory = (item: ItemSummary, category: Category) =>
  category === 'all' || (category === 'weapons' ? isWeapon(item) : isArmor(item))

/** Every word must appear somewhere in the item's name, type, element, slot or perks. */
const matchesQuery = (item: ItemSummary, words: readonly string[]) =>
  words.every((word) => haystack(item).includes(word))

const comparators: Record<Sort, (a: ItemSummary, b: ItemSummary) => number> = {
  power: (a, b) => (b.power ?? 0) - (a.power ?? 0) || a.name.localeCompare(b.name),
  newest: (a, b) => (b.acquiredAt ?? '').localeCompare(a.acquiredAt ?? ''),
  stats: (a, b) => (b.statTotal ?? -1) - (a.statTotal ?? -1) || (b.power ?? 0) - (a.power ?? 0),
  name: (a, b) => a.name.localeCompare(b.name),
}

export function filterVault(
  items: readonly ItemSummary[],
  filter: VaultFilter,
  now: number = Date.now(),
): ItemSummary[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  return items
    .filter(
      (item) =>
        inCategory(item, filter.category) &&
        (filter.tiers.size === 0 || filter.tiers.has(item.tier)) &&
        (filter.elements.size === 0 || filter.elements.has(item.damageType)) &&
        (filter.classes.size === 0 ||
          (item.classType !== null && filter.classes.has(item.classType))) &&
        [...filter.flags].every((flag) => matchesFlag(item, flag, now)) &&
        (words.length === 0 || matchesQuery(item, words)),
    )
    .sort(comparators[filter.sort])
}

/** How many items each flag chip would show within the current category. */
export function flagCounts(
  items: readonly ItemSummary[],
  category: Category,
  now: number = Date.now(),
): Record<Flag, number> {
  const counts: Record<Flag, number> = { dupes: 0, junk: 0, unlocked: 0, new: 0 }
  for (const item of items) {
    if (!inCategory(item, category)) continue
    for (const flag of FLAGS) {
      if (matchesFlag(item, flag, now)) counts[flag]++
    }
  }
  return counts
}

export const toggle = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
  const next = new Set(set)
  if (!next.delete(value)) next.add(value)
  return next
}

export const SORT_LABEL: Record<Sort, string> = {
  power: 'POWER',
  newest: 'NEWEST',
  stats: 'STAT TOTAL',
  name: 'A–Z',
}

type Facet = 'tiers' | 'elements' | 'classes' | 'flags'
const FACETS: readonly Facet[] = ['tiers', 'elements', 'classes', 'flags']

export interface ActiveFilter {
  readonly id: string
  readonly label: string
}

/** Everything narrowing the list right now, as chips the player can tap to remove. */
export const activeFilters = (filter: VaultFilter): ActiveFilter[] => [
  ...(filter.category === 'all' ? [] : [{ id: 'category', label: filter.category.toUpperCase() }]),
  ...FACETS.flatMap((facet) =>
    [...filter[facet]].map((value) => ({
      id: `${facet}:${value}`,
      label: facet === 'classes' ? `${value.toUpperCase()} ARMOR` : value.toUpperCase(),
    })),
  ),
]

export const removeFilter = (filter: VaultFilter, id: string): VaultFilter => {
  if (id === 'category') return { ...filter, category: 'all' }
  const facet = FACETS.find((each) => id.startsWith(`${each}:`))
  if (facet === undefined) return filter
  const value = id.slice(facet.length + 1)
  return {
    ...filter,
    [facet]: new Set([...filter[facet]].filter((each) => each !== value)),
  }
}
