import type { RecentItem } from '@ghost/contract'

export function clock(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Just now", "3h old", "2d old": how stale a piece of data is. */
export function age(iso: string, now: number = Date.now()) {
  const hours = (now - Date.parse(iso)) / 3_600_000
  if (!Number.isFinite(hours)) return 'Date unknown'
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${Math.floor(hours)}h old`
  return `${Math.floor(hours / 24)}d old`
}

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export const upper = (s: string) => s.toUpperCase()

export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

export const sourceLabel = (source: string) =>
  source === 'postmaster'
    ? 'From postmaster'
    : source === 'drop' || source === 'unknown'
      ? 'Drops'
      : sentence(source)

export const locationLabel = (location: RecentItem['location']) =>
  location === 'vault'
    ? 'Now in vault'
    : location === 'postmaster'
      ? 'In postmaster'
      : 'On character'

export interface RecentGroup {
  readonly key: string
  readonly at: string
  readonly source: string
  readonly jobId: string | null
  readonly items: RecentItem[]
}

/**
 * Group recent items into arrivals: same source (or same Ghost request) and
 * first seen within the same ten minutes. Input is newest first.
 */
export function groupRecent(items: ReadonlyArray<RecentItem>): RecentGroup[] {
  const groups: RecentGroup[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    const close =
      last !== undefined &&
      Date.parse(last.at) - Date.parse(item.firstSeenAt) < 10 * 60_000 &&
      (item.jobId !== null
        ? item.jobId === last.jobId
        : last.jobId === null && item.source === last.source)
    if (close) last.items.push(item)
    else
      groups.push({
        key: `${item.firstSeenAt}|${item.jobId ?? item.source}`,
        at: item.firstSeenAt,
        source: item.source,
        jobId: item.jobId,
        items: [item],
      })
  }
  return groups
}
