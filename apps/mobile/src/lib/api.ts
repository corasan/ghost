import { type CreateJob, GhostApi, type ItemDecision } from "@ghost/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { getServerUrl } from "./server-url"

// HttpApiClient reads the same contract the server implements, so every
// call below is typed end to end: params, payload, success and error
// shapes all come from packages/contract.
const makeApi = (baseUrl: string) =>
  Effect.runPromise(
    HttpApiClient.make(GhostApi, { baseUrl }).pipe(Effect.provide(FetchHttpClient.layer)),
  )

type Api = Awaited<ReturnType<typeof makeApi>>

const run = async <A, E>(f: (api: Api) => Effect.Effect<A, E>) =>
  Effect.runPromise(f(await makeApi(getServerUrl())))

export const queryKeys = {
  health: (url: string) => ["health", url] as const,
  jobs: (url: string) => ["jobs", url] as const,
  job: (url: string, id: string) => ["jobs", url, id] as const,
  recent: (url: string) => ["recent", url] as const,
  guardian: (url: string) => ["guardian", url] as const,
  vault: (url: string) => ["vault", url] as const,
}

// Health doubles as a latency probe: the Ghost tab header shows how far
// away the server is, like the "MCP · LOCAL · 12ms" pill in the design.
let lastLatencyMs: number | null = null
export const getLastLatency = () => lastLatencyMs

export function useHealth() {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.health(url),
    queryFn: async () => {
      const started = Date.now()
      const health = await run((api) => api.health.status())
      lastLatencyMs = Date.now() - started
      return health
    },
    refetchInterval: 15_000,
    retry: false,
  })
}

export function useJobs() {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.jobs(url),
    queryFn: () => run((api) => api.jobs.list()),
    refetchInterval: 5_000,
  })
}

// A single job is polled quickly while it is queued or running and left
// alone once it has settled.
export function useJob(id: string) {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.job(url, id),
    queryFn: () => run((api) => api.jobs.get({ params: { id } })),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "queued" || status === "running" ? 2_000 : false
    },
  })
}

export function useRecentItems() {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.recent(url),
    queryFn: () => run((api) => api.inventory.recent()),
    refetchInterval: 15_000,
  })
}

// Bungie-backed reads are slower (a profile call plus a manifest lookup)
// and fail with BungieNotLinked until OAuth is done, so they do not retry.
export function useGuardian() {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.guardian(url),
    queryFn: () => run((api) => api.guardian.snapshot()),
    staleTime: 60_000,
    retry: false,
  })
}

export function useVault() {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.vault(url),
    queryFn: () => run((api) => api.guardian.vault()),
    staleTime: 60_000,
    retry: false,
  })
}

export function useSetDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; decision: ItemDecision | null }) =>
      run((api) =>
        api.inventory.decide({ params: { id: input.id }, payload: { decision: input.decision } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recent"] }),
  })
}

/** True when the error is the server saying the Bungie account is not linked. */
export const isNotLinked = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: string })._tag === "BungieNotLinked"

export const errorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function useCreateJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateJob) => run((api) => api.jobs.create({ payload: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  })
}

export function useBungieAuthStart() {
  return useMutation({ mutationFn: () => run((api) => api.auth.start()) })
}
