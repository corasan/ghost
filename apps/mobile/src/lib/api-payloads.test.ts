import { describe, expect, test } from "bun:test"
import { GhostApi } from "@ghost/contract"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

const makeClient = HttpApiClient.make(GhostApi, { baseUrl: "http://ghost.test" })
type Client = Effect.Success<typeof makeClient>

type Sent = { method: string; path: string; body: unknown }

const send = async (call: (api: Client) => Effect.Effect<unknown, unknown>) => {
  const sent: Sent[] = []
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      sent.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.json(),
      })
      return new Response("{}", { status: 500 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )

  await Effect.runPromise(
    makeClient.pipe(
      Effect.flatMap(call),
      Effect.exit,
      Effect.provide(
        FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
      ),
    ),
  )
  return sent
}

describe("client payloads are plain objects, the way the app sends them", () => {
  test("creating a job", async () => {
    const payload = {
      kind: "chat",
      prompt: "What should I run tonight?",
      characterId: null,
    } as const
    expect(await send((api) => api.jobs.create({ payload }))).toEqual([
      { method: "POST", path: "/jobs", body: payload },
    ])
  })

  test("creating a job with no character selected", async () => {
    const payload = { kind: "vault_cleanup", prompt: "Clean up my vault" } as const
    expect(await send((api) => api.jobs.create({ payload }))).toEqual([
      { method: "POST", path: "/jobs", body: payload },
    ])
  })

  test("continuing a conversation", async () => {
    const payload = { kind: "chat", prompt: "And the exotics?", sessionId: "s-1" } as const
    expect(await send((api) => api.jobs.create({ payload }))).toEqual([
      { method: "POST", path: "/jobs", body: payload },
    ])
  })

  test("equipping an item on a character", async () => {
    const payload = { action: "equip", characterId: "2305843009" } as const
    expect(await send((api) => api.items.act({ params: { id: "6917529" }, payload }))).toEqual([
      { method: "POST", path: "/items/6917529/action", body: payload },
    ])
  })

  test("choosing an effort level", async () => {
    const payload = { effort: "xhigh" } as const
    expect(await send((api) => api.agent.configure({ payload }))).toEqual([
      { method: "POST", path: "/agent", body: payload },
    ])
  })

  test("applying a plan", async () => {
    const payload = { selected: ["6917529", "6917530"] }
    expect(await send((api) => api.jobs.apply({ params: { id: "job-1" }, payload }))).toEqual([
      { method: "POST", path: "/jobs/job-1/apply", body: payload },
    ])
  })

  test("deciding on an item", async () => {
    const payload = { decision: "junk" } as const
    expect(
      await send((api) => api.inventory.decide({ params: { id: "6917529" }, payload })),
    ).toEqual([{ method: "POST", path: "/inventory/recent/6917529/decision", body: payload }])
  })

  test("clearing a decision", async () => {
    const payload = { decision: null }
    expect(
      await send((api) => api.inventory.decide({ params: { id: "6917529" }, payload })),
    ).toEqual([{ method: "POST", path: "/inventory/recent/6917529/decision", body: payload }])
  })
})
