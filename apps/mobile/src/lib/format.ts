import type { RecentItem } from "@ghost/contract"

export function clock(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** "TODAY", "3H OLD", "2D OLD": how stale a piece of data is. */
export function age(iso: string, now: number = Date.now()) {
  const hours = (now - Date.parse(iso)) / 3_600_000
  if (!Number.isFinite(hours)) return "DATE UNKNOWN"
  if (hours < 1) return "JUST NOW"
  if (hours < 24) return `${Math.floor(hours)}H OLD`
  return `${Math.floor(hours / 24)}D OLD`
}

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export const upper = (s: string) => s.toUpperCase()

export const sourceLabel = (source: string) =>
  source === "postmaster"
    ? "FROM POSTMASTER"
    : source === "drop" || source === "unknown"
      ? "DROPS"
      : upper(source)

export const locationLabel = (location: RecentItem["location"]) =>
  location === "vault"
    ? "NOW IN VAULT"
    : location === "postmaster"
      ? "IN POSTMASTER"
      : "ON CHARACTER"

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
