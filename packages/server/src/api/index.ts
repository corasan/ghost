import {
  BungieAuthFailed,
  BungieAuthResult,
  BungieAuthStart,
  BungieFailed,
  GhostApi,
  Health,
} from "@ghost/contract"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { BungieClient } from "../bungie/client.ts"
import { Guardian } from "../bungie/guardian.ts"
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
  handlers
    .handle("recent", () => Effect.flatMap(ItemsRepo, (items) => items.recent).pipe(Effect.orDie))
    .handle("decide", ({ params, payload }) =>
      Effect.gen(function* () {
        const items = yield* ItemsRepo
        const updated = yield* items.setDecision(params.id, payload.decision).pipe(Effect.orDie)
        // The contract does not declare a not-found error for this route,
        // so an unknown id is a defect (500) rather than a typed failure.
        return yield* Option.match(updated, {
          onNone: () => Effect.die(new Error(`unknown item ${params.id}`)),
          onSome: Effect.succeed,
        })
      }),
    ),
)

// BungieError carries Bungie's status and message; the contract exposes it
// as BungieFailed so the app can show the text without knowing the shape.
const GuardianLive = HttpApiBuilder.group(GhostApi, "guardian", (handlers) =>
  handlers
    .handle("snapshot", () =>
      Effect.flatMap(Guardian, (g) => g.snapshot).pipe(
        Effect.catchTag("BungieError", (e) => new BungieFailed({ message: e.message })),
      ),
    )
    .handle("vault", () =>
      Effect.flatMap(Guardian, (g) => g.vault).pipe(
        Effect.catchTag("BungieError", (e) => new BungieFailed({ message: e.message })),
      ),
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
  Layer.provide([HealthLive, JobsLive, InventoryLive, GuardianLive, AuthLive]),
  Layer.merge(HttpApiScalar.layer(GhostApi, { path: "/docs" })),
)
