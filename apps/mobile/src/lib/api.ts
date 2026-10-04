import { type CreateJob, GhostApi, type ItemDecision, type Job, RecentItem } from "@ghost/contract"
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { getServerUrl, useServerUrl } from "./server-url"

// HttpApiClient reads the same contract the server implements, so every
// call below is typed end to end: params, payload, success and error
// shapes all come from packages/contract.
const makeApi = (baseUrl: string) =>
  Effect.runPromise(
    HttpApiClient.make(GhostApi, { baseUrl }).pipe(Effect.provide(FetchHttpClient.layer)),
  )

type Api = Awaited<ReturnType<typeof makeApi>>

// Building the client walks the whole contract, so do it once per server URL
// instead of once per request.
let client: { url: string; api: Promise<Api> } | undefined
const apiFor = (url: string) => {
  if (client?.url !== url) client = { url, api: makeApi(url) }
  return client.api
}

const run = async <A, E>(f: (api: Api) => Effect.Effect<A, E>) =>
  Effect.runPromise(f(await apiFor(getServerUrl())))

// Every key starts with the server URL so pointing the app at another
// server never shows the old server's cached data.
export const queryKeys = {
  health: (url: string) => [url, "health"] as const,
  jobs: (url: string) => [url, "jobs"] as const,
  recent: (url: string, characterId: string | undefined) => [url, "recent", characterId] as const,
  guardian: (url: string) => [url, "guardian"] as const,
  vault: (url: string) => [url, "vault"] as const,
  briefing: (url: string, characterId: string | undefined) =>
    [url, "briefing", characterId] as const,
  history: (url: string) => [url, "history"] as const,
}

/** Queries worth keeping on disk so the app opens on real data, not spinners. */
export const PERSISTED = new Set(["jobs", "recent", "guardian", "vault", "briefing", "history"])

const HEALTH_TIMEOUT_MS = 8_000

// Health doubles as a latency probe for the "MCP · LOCAL · 12MS" line in the menu.
let lastLatencyMs: number | null = null
export const getLastLatency = () => lastLatencyMs

export function useHealth() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.health(url),
    queryFn: async () => {
      const started = Date.now()
      const health = await Promise.race([
        run((api) => api.health.status()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timed out")), HEALTH_TIMEOUT_MS),
        ),
      ])
      lastLatencyMs = Date.now() - started
      return health
    },
    refetchInterval: 30_000,
    retry: false,
  })
}

const busy = (jobs: readonly Job[] | undefined) =>
  jobs?.some((job) => job.status === "queued" || job.status === "running") ?? false

// The chat polls quickly only while Ghost is thinking; an idle chat checks
// in rarely, so the phone isn't waking the server every few seconds.
export function useJobs() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.jobs(url),
    queryFn: () => run((api) => api.jobs.list()),
    refetchInterval: (query) => (busy(query.state.data) ? 1_500 : 30_000),
    staleTime: 5_000,
  })
}

export function useRecentItems(characterId: string | undefined) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.recent(url, characterId),
    queryFn: () =>
      run((api) => api.inventory.recent({ query: characterId ? { characterId } : {} })),
    staleTime: 30_000,
  })
}

// Bungie-backed reads cost a profile call on the server (cached there for
// 30 seconds) and fail with BungieNotLinked until OAuth is done, so they do
// not retry and are considered fresh for a minute.
export function useGuardian() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.guardian(url),
    queryFn: () => run((api) => api.guardian.snapshot()),
    staleTime: 60_000,
    retry: false,
  })
}

export function useVault() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.vault(url),
    queryFn: () => run((api) => api.guardian.vault()),
    staleTime: 60_000,
    retry: false,
  })
}

export function useBriefing(characterId: string | undefined) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.briefing(url, characterId),
    queryFn: () =>
      run((api) => api.guardian.briefing({ query: characterId ? { characterId } : {} })),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  })
}

export function useHistory() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.history(url),
    queryFn: () => run((api) => api.jobs.history()),
    staleTime: 15_000,
  })
}

/** After items move, everything that shows items or counts is out of date. */
const invalidateInventory = (queryClient: QueryClient) =>
  Promise.all(
    ["jobs", "recent", "guardian", "vault", "briefing", "history"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [getServerUrl(), key] }),
    ),
  )

export function useSetDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; decision: ItemDecision | null }) =>
      run((api) =>
        api.inventory.decide({ params: { id: input.id }, payload: { decision: input.decision } }),
      ),
    // Keep/junk should feel instant, so patch the cached lists first and let
    // the refetch confirm it.
    onMutate: (input) => {
      queryClient.setQueriesData<readonly RecentItem[]>(
        { queryKey: [getServerUrl(), "recent"] },
        (items) =>
          items?.map((item) =>
            item.itemInstanceId === input.id
              ? new RecentItem({ ...item, decision: input.decision })
              : item,
          ),
      )
    },
    onSettled: () =>
      Promise.all(
        ["recent", "vault", "briefing"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [getServerUrl(), key] }),
        ),
      ),
  })
}

export function useCreateJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateJob) => run((api) => api.jobs.create({ payload: input })),
    onSuccess: (job) => {
      queryClient.setQueryData<readonly Job[]>(queryKeys.jobs(getServerUrl()), (jobs) => [
        job,
        ...(jobs ?? []),
      ])
      return queryClient.invalidateQueries({ queryKey: queryKeys.jobs(getServerUrl()) })
    },
  })
}

const replaceJob = (queryClient: QueryClient, job: Job) =>
  queryClient.setQueryData<readonly Job[]>(queryKeys.jobs(getServerUrl()), (jobs) =>
    jobs?.map((each) => (each.id === job.id ? job : each)),
  )

export function useApplyPlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { jobId: string; selected: readonly string[] }) =>
      run((api) =>
        api.jobs.apply({ params: { id: input.jobId }, payload: { selected: input.selected } }),
      ),
    onSuccess: (job) => {
      replaceJob(queryClient, job)
      return invalidateInventory(queryClient)
    },
  })
}

export function useUndoPlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => run((api) => api.jobs.undo({ params: { id: jobId } })),
    onSuccess: (job) => {
      replaceJob(queryClient, job)
      return invalidateInventory(queryClient)
    },
  })
}

export function useBungieAuthStart() {
  return useMutation({ mutationFn: () => run((api) => api.auth.start()) })
}

/** True when the error is the server saying the Bungie account is not linked. */
export const isNotLinked = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: string })._tag === "BungieNotLinked"

export const errorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    if ("reason" in error) return String((error as { reason: unknown }).reason)
    if ("message" in error) return String((error as { message: unknown }).message)
  }
  return String(error)
}
