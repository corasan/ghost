import type { Job } from "@ghost/contract"

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
  const date = new Date(iso)
  const two = (value: number) => String(value).padStart(2, "0")
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
