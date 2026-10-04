import {
  BungieAuthFailed,
  BungieAuthResult,
  BungieAuthStart,
  GhostApi,
  Health,
} from "@ghost/contract"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { BungieClient } from "../bungie/client.ts"
import { ItemsRepo } from "../db/items.ts"
import { JobsRepo } from "../db/jobs.ts"

const VERSION = "0.0.0"

const HealthLive = HttpApiBuilder.group(GhostApi, "health", (handlers) =>
  handlers.handle("status", () =>
    Effect.gen(function* () {
      const bungie = yield* BungieClient
      const bungieLinked = yield* bungie.isLinked
      return new Health({ ok: true, version: VERSION, bungieLinked })
    }),
  ),
)

const JobsLive = HttpApiBuilder.group(GhostApi, "jobs", (handlers) =>
  handlers
    .handle("list", () => Effect.flatMap(JobsRepo, (jobs) => jobs.list).pipe(Effect.orDie))
    .handle("create", ({ payload }) =>
      Effect.flatMap(JobsRepo, (jobs) => jobs.create(payload)).pipe(Effect.orDie),
    )
    .handle("get", ({ params }) =>
      Effect.flatMap(JobsRepo, (jobs) => jobs.get(params.id)).pipe(
        Effect.catchTag("SqlError", Effect.die),
      ),
    ),
)

const InventoryLive = HttpApiBuilder.group(GhostApi, "inventory", (handlers) =>
  handlers.handle("recent", () =>
    Effect.flatMap(ItemsRepo, (items) => items.recent).pipe(Effect.orDie),
  ),
)

const Memberships = Schema.Struct({
  bungieNetUser: Schema.Struct({ membershipId: Schema.String, displayName: Schema.String }),
})

const AuthLive = HttpApiBuilder.group(GhostApi, "auth", (handlers) =>
  handlers
    .handle("start", () =>
      Effect.flatMap(BungieClient, (bungie) =>
        Effect.map(bungie.authorizeUrl, (url) => new BungieAuthStart({ url })),
      ),
    )
    .handle("callback", ({ query }) =>
      Effect.gen(function* () {
        const bungie = yield* BungieClient
        yield* bungie.exchangeCode(query.code)
        const raw = yield* bungie.get("/User/GetMembershipsForCurrentUser/")
        const me = yield* Schema.decodeUnknownEffect(Memberships)(raw)
        return new BungieAuthResult({
          membershipId: me.bungieNetUser.membershipId,
          displayName: me.bungieNetUser.displayName,
        })
      }).pipe(Effect.mapError((error) => new BungieAuthFailed({ reason: String(error) }))),
    ),
)

// /docs serves an interactive reference generated from the contract, handy
// for poking the server from a laptop on the tailnet.
export const ApiLive = HttpApiBuilder.layer(GhostApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide([HealthLive, JobsLive, InventoryLive, AuthLive]),
  Layer.merge(HttpApiScalar.layer(GhostApi, { path: "/docs" })),
)
