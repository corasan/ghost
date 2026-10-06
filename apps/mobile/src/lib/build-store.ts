import { type BuildFilter, emptyBuildFilter } from "./build-filter"
import { store } from "./store"

const filter = store<BuildFilter>(emptyBuildFilter)

export const useBuildFilter = filter.use
export const setBuildFilter = (patch: Partial<BuildFilter>) =>
  filter.set({ ...filter.get(), ...patch })
export const replaceBuildFilter = filter.set
export const resetBuildFilter = () =>
  filter.set({ ...emptyBuildFilter, query: filter.get().query, sort: filter.get().sort })
