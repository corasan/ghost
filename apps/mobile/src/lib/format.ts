import type { Job, RecentItem } from "@ghost/contract"

export const kindLabel: Record<Job["kind"], string> = {
  chat: "Ask Ghost",
  build_suggestion: "Build suggestion",
  weapon_rolls: "Weapon rolls",
  vault_cleanup: "Vault cleanup",
  postmaster_to_vault: "Postmaster to vault",
}

export const statusLabel: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
}

export function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function clock(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export const upper = (s: string) => s.toUpperCase()

export const sourceLabel = (source: string) =>
  source === "postmaster" ? "FROM POSTMASTER" : source === "unknown" ? "ACQUIRED" : upper(source)

export const locationLabel = (location: RecentItem["location"]) =>
  location === "vault"
    ? "NOW IN VAULT"
    : location === "postmaster"
      ? "IN POSTMASTER"
      : "ON CHARACTER"

/** Group recent items by source and the minute they were first seen, newest first. */
export function groupRecent(items: ReadonlyArray<RecentItem>) {
  const groups = new Map<string, { key: string; at: string; source: string; items: RecentItem[] }>()
  for (const item of items) {
    const minute = item.firstSeenAt.slice(0, 16)
    const key = `${minute}|${item.source}`
    const group = groups.get(key) ?? { key, at: item.firstSeenAt, source: item.source, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return Array.from(groups.values())
}
