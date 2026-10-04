import { type CreateJob, GhostApi } from "@ghost/contract"
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
}

export function useHealth() {
  const url = getServerUrl()
  return useQuery({
    queryKey: queryKeys.health(url),
    queryFn: () => run((api) => api.health.status()),
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
