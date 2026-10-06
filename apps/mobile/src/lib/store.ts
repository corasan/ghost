import { useSyncExternalStore } from "react"

/** A value screens share in memory, read with `use` so a change re-renders every reader. */
export function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    get: () => value,
    set: (next: T) => {
      value = next
      for (const listener of listeners) listener()
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}
