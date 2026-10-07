import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { QueryClient } from "@tanstack/react-query"
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client"
import Storage from "expo-sqlite/kv-store"

import { PERSISTED } from "./api"

// Two layers of caching. In memory, TanStack Query dedupes requests and
// serves fresh data instantly between screens. On disk, the cache is saved to
// SQLite and restored on launch, so the app opens on the last known vault and
// chat while the network catches up, instead of on a spinner.
const WEEK = 7 * 24 * 60 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    // gcTime must outlive maxAge, or restored queries are dropped before use.
    queries: { gcTime: WEEK },
  },
})

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: createAsyncStoragePersister({
    storage: Storage,
    key: "ghost.query-cache",
    // Writes are batched: a burst of refetches costs one disk write.
    throttleTime: 2_000,
  }),
  maxAge: WEEK,
  // Bump when a contract change makes old cached shapes unreadable.
  buster: "v6",
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" && PERSISTED.has(String(query.queryKey[1])),
  },
}
