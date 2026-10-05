// "Since last time" needs a stable start: the app refetches the briefing
// often while open, and the numbers must not reset on every refetch. A new
// session starts after a 45 minute gap; until then the start is remembered.

export const SESSION_GAP_MS = 45 * 60 * 1000

export interface SessionWindow {
  /** Start of the comparison window; null on the very first run. */
  readonly since: string | null
  /** True when this request opened a new session, so `since` must be stored. */
  readonly started: boolean
}

export const sessionWindow = (
  nowMs: number,
  lastActiveAt: string | null,
  storedSince: string | null,
): SessionWindow => {
  if (lastActiveAt === null) return { since: null, started: false }
  if (nowMs - Date.parse(lastActiveAt) > SESSION_GAP_MS) {
    return { since: lastActiveAt, started: true }
  }
  return { since: storedSince, started: false }
}
