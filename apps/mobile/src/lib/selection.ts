import type { Plan } from "@ghost/contract"
import { useSyncExternalStore } from "react"

// Which plan rows the player has left ticked, per job. It lives outside the
// components because the same plan renders in two places (the chat and the
// vault's cleanup mode), and list cells are recycled as they scroll, so
// component state would be lost or shared with the wrong row.

const selections = new Map<string, ReadonlySet<string>>()
const listeners = new Set<() => void>()

const actionable = (plan: Plan) =>
  plan.rows.filter((row) => row.action !== "none" || row.armorMods?.some((mod) => mod.swap))

const defaults = (plan: Plan) =>
  new Set(actionable(plan).flatMap((row) => (row.selected ? [row.itemInstanceId] : [])))

const emit = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePlanSelection(jobId: string, plan: Plan) {
  const selected = useSyncExternalStore(subscribe, () => selections.get(jobId))
  const current = selected ?? defaults(plan)
  const write = (next: ReadonlySet<string>) => {
    selections.set(jobId, next)
    emit()
  }
  return {
    selected: current,
    toggle: (id: string) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      write(next)
    },
    setAll: (on: boolean) =>
      write(new Set(on ? actionable(plan).map((row) => row.itemInstanceId) : [])),
    actionableCount: actionable(plan).length,
  }
}
