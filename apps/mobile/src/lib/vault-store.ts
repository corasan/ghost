import { useSyncExternalStore } from "react"

import { emptyFilter, toggle, type VaultFilter } from "./vault-filter"

function store<T>(initial: T) {
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

const filter = store<VaultFilter>(emptyFilter)
const picked = store<ReadonlySet<string>>(new Set())

export const useVaultFilter = filter.use
export const setVaultFilter = (patch: Partial<VaultFilter>) =>
  filter.set({ ...filter.get(), ...patch })
export const replaceVaultFilter = filter.set
export const resetVaultFilter = () =>
  filter.set({ ...emptyFilter, query: filter.get().query, sort: filter.get().sort })

export const usePicked = picked.use
export const togglePicked = (id: string) => picked.set(toggle(picked.get(), id))
export const clearPicked = () => picked.set(new Set())
