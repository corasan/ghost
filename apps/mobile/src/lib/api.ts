import {
  type AgentEffort,
  type CleanupSession,
  type CleanupStage,
  type CreateJob,
  type EquipBuild,
  GhostApi,
  type ItemAction,
  type ItemDecision,
  ItemSummary,
  type Job,
  RecentItem,
  type ReviewItem,
  type SaveBuild,
  type SavedBuild,
  type ApplyPerks,
  type SetPerkRating,
  VaultSnapshot,
} from '@ghost/contract'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Effect } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { getServerToken, getServerUrl, useServerUrl } from './server-url'

// HttpApiClient reads the same contract the server implements, so every
// call below is typed end to end: params, payload, success and error
// shapes all come from packages/contract.
// Every request carries the pairing token; the server refuses anything else.
const makeApi = (baseUrl: string, token: string) =>
  Effect.runPromise(
    HttpApiClient.make(GhostApi, {
      baseUrl,
      transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  )

type Api = Awaited<ReturnType<typeof makeApi>>

// Building the client walks the whole contract, so do it once per server URL
// and token instead of once per request.
let client: { url: string; token: string; api: Promise<Api> } | undefined
const apiFor = (url: string, token: string) => {
  if (client?.url !== url || client.token !== token)
    client = { url, token, api: makeApi(url, token) }
  return client.api
}

const run = async <A, E>(f: (api: Api) => Effect.Effect<A, E>) =>
  Effect.runPromise(f(await apiFor(getServerUrl(), getServerToken())))

// Every key starts with the server URL so pointing the app at another
// server never shows the old server's cached data.
export const queryKeys = {
  health: (url: string) => [url, 'health'] as const,
  jobs: (url: string, sessionId?: string | null) => [url, 'jobs', sessionId ?? 'all'] as const,
  sessions: (url: string) => [url, 'sessions'] as const,
  item: (url: string, id: string) => [url, 'item', id] as const,
  weaponSheet: (url: string, id: string) => [url, 'weaponSheet', id] as const,
  agent: (url: string) => [url, 'agent'] as const,
  recent: (url: string, characterId: string | undefined) => [url, 'recent', characterId] as const,
  guardian: (url: string) => [url, 'guardian'] as const,
  vault: (url: string) => [url, 'vault'] as const,
  briefing: (url: string, characterId: string | undefined) =>
    [url, 'briefing', characterId] as const,
  history: (url: string) => [url, 'history'] as const,
  situational: (url: string, characterId: string | undefined) =>
    [url, 'situational', characterId] as const,
  job: (url: string, id: string) => [url, 'job', id] as const,
  builds: (url: string) => [url, 'builds'] as const,
  loadoutSlots: (url: string, characterId: string | undefined) =>
    [url, 'loadoutSlots', characterId] as const,
  cleanup: (url: string) => [url, 'cleanup'] as const,
  cleanupPreview: (url: string, characterId: string | undefined) =>
    [url, 'cleanupPreview', characterId] as const,
  junkReview: (url: string) => [url, 'junkReview'] as const,
}

/** Queries worth keeping on disk so the app opens on real data, not spinners. */
export const PERSISTED = new Set([
  'jobs',
  'sessions',
  'recent',
  'guardian',
  'vault',
  'briefing',
  'history',
  'builds',
])

// The server counts "actions today" from midnight where the player is.
const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

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
          setTimeout(() => reject(new Error('Health check timed out')), HEALTH_TIMEOUT_MS),
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
  jobs?.some((job) => job.status === 'queued' || job.status === 'running') ?? false

const NO_JOBS: readonly Job[] = []

// The chat polls quickly only while Ghost is thinking; an idle chat checks
// in rarely, so the phone isn't waking the server every few seconds.
export function useJobs(sessionId?: string | null) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.jobs(url, sessionId),
    queryFn: () =>
      sessionId === null
        ? NO_JOBS
        : run((api) => api.jobs.list({ query: sessionId === undefined ? {} : { sessionId } })),
    refetchInterval: (query) => (busy(query.state.data) ? 1_500 : 30_000),
    staleTime: 5_000,
  })
}

export function useJob(id: string) {
  const url = useServerUrl()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: queryKeys.job(url, id),
    queryFn: () => run((api) => api.jobs.get({ params: { id } })),
    initialData: () =>
      queryClient
        .getQueriesData<readonly Job[]>({ queryKey: [url, 'jobs'] })
        .flatMap(([, jobs]) => jobs ?? [])
        .find((job) => job.id === id),
    staleTime: 5_000,
  })
}

export function useSessions() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.sessions(url),
    queryFn: () => run((api) => api.jobs.sessions()),
    staleTime: 15_000,
  })
}

export function useItemDetail(id: string) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.item(url, id),
    queryFn: () => run((api) => api.items.detail({ params: { id } })),
    staleTime: 30_000,
    retry: false,
  })
}

export function useWeaponSheet(id: string) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.weaponSheet(url, id),
    queryFn: () => run((api) => api.items.sheet({ params: { id } })),
    staleTime: 60_000,
    retry: false,
  })
}

export function useRatePerk(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetPerkRating) =>
      run((api) => api.items.ratePerk({ params: { id }, payload: input })),
    onSuccess: () =>
      Promise.all(
        ['weaponSheet', 'junkReview', 'cleanupPreview'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [getServerUrl(), key] }),
        ),
      ),
  })
}

export function useApplyPerks(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ApplyPerks) =>
      run((api) => api.items.applyPerks({ params: { id }, payload: input })),
    onSuccess: () =>
      Promise.all([
        invalidateInventory(queryClient),
        queryClient.invalidateQueries({ queryKey: [getServerUrl(), 'item'] }),
        queryClient.invalidateQueries({ queryKey: [getServerUrl(), 'weaponSheet'] }),
      ]),
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
      run((api) =>
        api.guardian.briefing({
          query:
            characterId === undefined ? { tz: localTimeZone } : { characterId, tz: localTimeZone },
        }),
      ),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  })
}

const SITUATIONAL_POLL = 5_000

/** Asks again while Ghost is still researching, since the server answers before it is done. */
export function useSituational(characterId: string | undefined) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.situational(url, characterId),
    queryFn: () =>
      run((api) => api.guardian.situational({ query: { characterId: characterId ?? '' } })),
    enabled: characterId !== undefined,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? SITUATIONAL_POLL : false),
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
export const invalidateInventory = (queryClient: QueryClient) =>
  Promise.all(
    [
      'jobs',
      'recent',
      'guardian',
      'vault',
      'briefing',
      'history',
      'builds',
      'cleanupPreview',
      'junkReview',
    ].map((key) => queryClient.invalidateQueries({ queryKey: [getServerUrl(), key] })),
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
        { queryKey: [getServerUrl(), 'recent'] },
        (items) =>
          items?.map((item) =>
            item.itemInstanceId === input.id
              ? new RecentItem({ ...item, decision: input.decision })
              : item,
          ),
      )
      queryClient.setQueriesData<VaultSnapshot>({ queryKey: [getServerUrl(), 'vault'] }, (vault) =>
        vault
          ? new VaultSnapshot({
              ...vault,
              items: vault.items.map((item) =>
                item.itemInstanceId === input.id
                  ? new ItemSummary({ ...item, decision: input.decision })
                  : item,
              ),
            })
          : vault,
      )
      queryClient.setQueriesData<readonly ReviewItem[]>(
        { queryKey: [getServerUrl(), 'junkReview'] },
        (items) => items?.filter((item) => item.itemInstanceId !== input.id),
      )
    },
    onSettled: () =>
      Promise.all(
        ['recent', 'vault', 'briefing', 'item', 'junkReview', 'cleanupPreview'].map((key) =>
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
      const url = getServerUrl()
      queryClient.setQueryData<readonly Job[]>(queryKeys.jobs(url, job.sessionId), (jobs) => [
        job,
        ...(jobs ?? []),
      ])
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: [url, 'jobs'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions(url) }),
      ])
    },
  })
}

const replaceJob = (queryClient: QueryClient, job: Job) =>
  queryClient.setQueriesData<readonly Job[]>({ queryKey: [getServerUrl(), 'jobs'] }, (jobs) =>
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

export function useItemAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string } & ItemAction) =>
      run((api) =>
        api.items.act({
          params: { id: input.id },
          payload: { action: input.action, characterId: input.characterId ?? null },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        invalidateInventory(queryClient),
        queryClient.invalidateQueries({ queryKey: [getServerUrl(), 'item'] }),
      ]),
  })
}

export function useAgentSettings() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.agent(url),
    queryFn: () => run((api) => api.agent.settings()),
    staleTime: 60_000,
    retry: false,
  })
}

export function useSetAgentEffort() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (effort: AgentEffort) => run((api) => api.agent.configure({ payload: { effort } })),
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.agent(getServerUrl()), settings),
  })
}

export function useBungieAuthStart() {
  return useMutation({ mutationFn: () => run((api) => api.auth.start()) })
}

export function useSavedBuilds() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.builds(url),
    queryFn: () => run((api) => api.builds.list()),
    staleTime: 30_000,
  })
}

const seedJob = (queryClient: QueryClient, job: Job) =>
  queryClient.setQueryData(queryKeys.job(getServerUrl(), job.id), job)

const refreshBuilds = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.builds(getServerUrl()) })

const patchBuilds = (
  queryClient: QueryClient,
  patch: (builds: readonly SavedBuild[]) => readonly SavedBuild[],
) =>
  queryClient.setQueryData<readonly SavedBuild[]>(queryKeys.builds(getServerUrl()), (builds) =>
    builds ? patch(builds) : builds,
  )

export function useSaveBuild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SaveBuild) => run((api) => api.builds.save({ payload })),
    onSuccess: (result) => {
      if (result.confirm) seedJob(queryClient, result.confirm)
      return Promise.all([
        refreshBuilds(queryClient),
        queryClient.invalidateQueries({ queryKey: [getServerUrl(), 'jobs'] }),
      ])
    },
  })
}

export function useRenameBuild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      run((api) => api.builds.rename({ params: { id: input.id }, payload: { name: input.name } })),
    onSuccess: (build) => {
      patchBuilds(queryClient, (builds) =>
        builds.map((each) => (each.id === build.id ? build : each)),
      )
      return refreshBuilds(queryClient)
    },
  })
}

export function useDeleteBuild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => run((api) => api.builds.remove({ params: { id } })),
    onSuccess: (_, id) => {
      patchBuilds(queryClient, (builds) => builds.filter((each) => each.id !== id))
      return refreshBuilds(queryClient)
    },
  })
}

export function useEquipBuild() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & EquipBuild) =>
      run((api) => api.builds.equip({ params: { id }, payload })),
    onSuccess: (result) => {
      seedJob(queryClient, result.job)
      return queryClient.invalidateQueries({ queryKey: [getServerUrl(), 'jobs'] })
    },
  })
}

export function useLoadoutSlots(characterId: string | undefined) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.loadoutSlots(url, characterId),
    queryFn: () => run((api) => api.builds.slots({ query: { characterId: characterId ?? '' } })),
    enabled: characterId !== undefined,
    staleTime: 30_000,
    retry: false,
  })
}

const WATCHED = new Set<CleanupStage>(['stashing', 'delivering', 'returning'])

export function useCleanup() {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.cleanup(url),
    queryFn: () => run((api) => api.cleanup.current()),
    refetchInterval: (query) =>
      query.state.data && WATCHED.has(query.state.data.stage) ? 2_000 : false,
    staleTime: 2_000,
  })
}

export function useJunkReview(enabled: boolean) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.junkReview(url),
    queryFn: () => run((api) => api.cleanup.review()),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useCleanupPreview(characterId: string | undefined) {
  const url = useServerUrl()
  return useQuery({
    queryKey: queryKeys.cleanupPreview(url, characterId),
    queryFn: () => run((api) => api.cleanup.preview({ query: { characterId: characterId ?? '' } })),
    enabled: characterId !== undefined,
    staleTime: 10_000,
    retry: false,
  })
}

export type CleanupAction = 'pause' | 'resume' | 'stop' | 'skip' | 'return' | 'close'

const cleanupAction = (api: Api, id: string, action: CleanupAction) => {
  const request = { params: { id } }
  switch (action) {
    case 'pause':
      return api.cleanup.pause(request)
    case 'resume':
      return api.cleanup.resume(request)
    case 'stop':
      return api.cleanup.stop(request)
    case 'skip':
      return api.cleanup.skip(request)
    case 'return':
      return api.cleanup.return(request)
    case 'close':
      return api.cleanup.close(request)
  }
}

const ENDED = new Set<CleanupStage>(['stopped', 'closed'])

const settleCleanup = (queryClient: QueryClient, session: CleanupSession) => {
  queryClient.setQueryData(
    queryKeys.cleanup(getServerUrl()),
    ENDED.has(session.stage) ? null : session,
  )
  return invalidateInventory(queryClient)
}

export function useStartCleanup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (characterId: string) =>
      run((api) => api.cleanup.start({ payload: { characterId } })),
    onSuccess: (session) => settleCleanup(queryClient, session),
  })
}

export function useCleanupAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; action: CleanupAction }) =>
      run((api) => cleanupAction(api, input.id, input.action)),
    onSuccess: (session) => settleCleanup(queryClient, session),
  })
}

export type CleanupMark = 'keep' | 'deleted'

export function useMarkCleanupItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      mark: CleanupMark
      itemIds: readonly [string, ...string[]]
    }) =>
      run((api) =>
        api.cleanup[input.mark]({ params: { id: input.id }, payload: { itemIds: input.itemIds } }),
      ),
    onSuccess: (session) => settleCleanup(queryClient, session),
  })
}

// The server answers 401 to a request without the right pairing token.
const unpaired = (error: Error) =>
  HttpClientError.isHttpClientError(error) && error.response?.status === 401

export const errorMessage = (error: Error | null) =>
  error === null
    ? String(error)
    : unpaired(error)
      ? 'Not paired with this server. Run `ghost pair` on it and scan the QR code.'
      : 'reason' in error
        ? String(error.reason)
        : error.message
