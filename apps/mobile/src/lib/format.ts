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

/** "940", "45.2K", "1.3M": a token count that fits a narrow column. */
export function tokens(count: number) {
  if (count < 1000) return String(Math.round(count))
  const [value, unit] = count < 1_000_000 ? [count / 1000, 'K'] : [count / 1_000_000, 'M']
  return `${value.toFixed(value < 100 ? 1 : 0).replace(/\.0$/, '')}${unit}`
}

export const usd = (amount: number) =>
  amount > 0 && amount < 0.01 ? '<$0.01' : `$${amount.toFixed(2)}`

export const percent = (share: number) => `${Math.round(share * 100)}%`

/** "in 42m", "in 3h 10m", "in 2d 4h": how long until a reset. */
export function until(iso: string, now: number = Date.now()) {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
}
