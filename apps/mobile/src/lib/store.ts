import { useSyncExternalStore } from 'react'

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
