import { store } from './store'
import { emptyFilter, toggle, type VaultFilter } from './vault-filter'

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
