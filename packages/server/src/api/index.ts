import {
  BungieAuthFailed,
  BungieAuthResult,
  BungieAuthStart,
  BungieFailed,
  GhostApi,
  Health,
  ItemNotFound,
  JudgeUnavailable,
  RatedPerk,
  WeaponPerks,
} from "@ghost/contract"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { AgentConfig } from "../agent/settings.ts"
import { Activity } from "../activity/activity.ts"
import { BungieClient, type BungieError } from "../bungie/client.ts"
import { Guardian } from "../bungie/guardian.ts"
import { Builds } from "../builds/builds.ts"
import { Cleanup } from "../cleanup/service.ts"
import { ItemsRepo } from "../db/items.ts"
import { PerkRatings } from "../db/perk-ratings.ts"
import { JobsRepo } from "../db/jobs.ts"
import { reviewItems } from "../junk/proposal.ts"
import { JunkJudge } from "../junk/service.ts"
import { Items } from "../items/items.ts"
import { Plans } from "../plans/executor.ts"

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

// BungieError carries Bungie's status and message; the contract exposes it
// as BungieFailed so the app can show the text without knowing the shape.
const toBungieFailed = (e: BungieError) => Effect.fail(new BungieFailed({ message: e.message }))

const JobsLive = HttpApiBuilder.group(GhostApi, "jobs", (handlers) =>
  handlers
    .handle("list", ({ query }) =>
      Effect.flatMap(JobsRepo, (jobs) =>
        query.sessionId === undefined ? jobs.list : jobs.inSession(query.sessionId),
      ).pipe(Effect.orDie),
    )
    .handle("sessions", () => Effect.flatMap(JobsRepo, (jobs) => jobs.sessions).pipe(Effect.orDie))
    .handle("create", ({ payload }) =>
      Effect.flatMap(JobsRepo, (jobs) => jobs.create(payload)).pipe(Effect.orDie),
    )
    .handle("get", ({ params }) =>
      Effect.flatMap(JobsRepo, (jobs) => jobs.get(params.id)).pipe(
        Effect.catchTag("SqlError", Effect.die),
      ),
    )
    .handle("apply", ({ params, payload }) =>
      Effect.flatMap(Plans, (plans) => plans.apply(params.id, payload.selected)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("undo", ({ params }) =>
      Effect.flatMap(Plans, (plans) => plans.undo(params.id)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("history", () => Effect.flatMap(Plans, (plans) => plans.history)),
)

const InventoryLive = HttpApiBuilder.group(GhostApi, "inventory", (handlers) =>
  handlers
    .handle("recent", ({ query }) => Effect.flatMap(Activity, (a) => a.recent(query.characterId)))
    .handle("decide", ({ params, payload }) =>
      Effect.gen(function* () {
        const activity = yield* Activity
        const updated = yield* activity.decide(params.id, payload.decision)
        // The contract does not declare a not-found error for this route,
        // so an unknown id is a defect (500) rather than a typed failure.
        return yield* Option.match(updated, {
          onNone: () => Effect.die(new Error(`unknown item ${params.id}`)),
          onSome: Effect.succeed,
        })
      }),
    ),
)

const weaponPerks = (id: string) =>
  Effect.flatMap(JunkJudge, (judge) => judge.perksOf(id)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new ItemNotFound({ id })),
        onSome: ({ item, columns }) =>
          Effect.succeed(
            new WeaponPerks({
              weapon: item.name,
              columns: columns.map((column) => column.map((perk) => new RatedPerk(perk))),
            }),
          ),
      }),
    ),
    Effect.catchTag("BungieError", toBungieFailed),
    Effect.catchTag("WishlistError", (e) =>
      Effect.fail(new JudgeUnavailable({ reason: e.message })),
    ),
  )

const ItemsApiLive = HttpApiBuilder.group(GhostApi, "items", (handlers) =>
  handlers
    .handle("detail", ({ params }) =>
      Effect.flatMap(Items, (items) => items.detail(params.id)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("act", ({ params, payload }) =>
      Effect.flatMap(Items, (items) => items.act(params.id, payload)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("perks", ({ params }) => weaponPerks(params.id))
    .handle("ratePerk", ({ params, payload }) =>
      Effect.gen(function* () {
        const current = yield* weaponPerks(params.id)
        const ratings = yield* PerkRatings
        const write =
          payload.rating === null
            ? ratings.clear(current.weapon, payload.perk, "player")
            : ratings.set({
                weapon: current.weapon,
                perk: payload.perk,
                rating: payload.rating,
                source: "player",
                note: null,
                url: null,
              })
        yield* write.pipe(Effect.orDie)
        return yield* weaponPerks(params.id)
      }),
    ),
)

const GuardianLive = HttpApiBuilder.group(GhostApi, "guardian", (handlers) =>
  handlers
    .handle("snapshot", () =>
      Effect.flatMap(Guardian, (g) => g.snapshot).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("situational", ({ query }) =>
      Effect.flatMap(Guardian, (g) => g.situational(query.characterId)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("vault", () =>
      Effect.flatMap(Guardian, (g) => g.vault).pipe(Effect.catchTag("BungieError", toBungieFailed)),
    )
    .handle("briefing", ({ query }) =>
      Effect.flatMap(Activity, (a) => a.briefing(query.characterId)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    ),
)

const BuildsLive = HttpApiBuilder.group(GhostApi, "builds", (handlers) =>
  handlers
    .handle("list", () => Effect.flatMap(Builds, (builds) => builds.list))
    .handle("save", ({ payload }) =>
      Effect.flatMap(Builds, (builds) => builds.save(payload)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("rename", ({ params, payload }) =>
      Effect.flatMap(Builds, (builds) => builds.rename(params.id, payload.name)),
    )
    .handle("remove", ({ params }) => Effect.flatMap(Builds, (builds) => builds.remove(params.id)))
    .handle("equip", ({ params, payload }) =>
      Effect.flatMap(Builds, (builds) => builds.equip(params.id, payload)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("slots", ({ query }) =>
      Effect.flatMap(Builds, (builds) => builds.slots(query.characterId)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    ),
)

const AgentLive = HttpApiBuilder.group(GhostApi, "agent", (handlers) =>
  handlers
    .handle("settings", () => Effect.flatMap(AgentConfig, (agent) => agent.current))
    .handle("configure", ({ payload }) =>
      Effect.flatMap(AgentConfig, (agent) => agent.setEffort(payload.effort)),
    ),
)

const CleanupApiLive = HttpApiBuilder.group(GhostApi, "cleanup", (handlers) =>
  handlers
    .handle("preview", ({ query }) =>
      Effect.flatMap(Cleanup, (c) => c.preview(query.characterId)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("current", () => Effect.flatMap(Cleanup, (c) => c.current))
    .handle("review", () =>
      Effect.gen(function* () {
        const judgment = yield* Effect.flatMap(JunkJudge, (judge) => judge.judgeVault)
        const decisions = yield* Effect.flatMap(ItemsRepo, (items) => items.decisions).pipe(
          Effect.orDie,
        )
        return reviewItems(judgment, (id) => (decisions.get(id)?.decision ?? null) !== null)
      }).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
        Effect.catchTag("WishlistError", (e) =>
          Effect.fail(new JudgeUnavailable({ reason: e.message })),
        ),
      ),
    )
    .handle("start", ({ payload }) =>
      Effect.flatMap(Cleanup, (c) => c.start(payload.characterId)).pipe(
        Effect.catchTag("BungieError", toBungieFailed),
      ),
    )
    .handle("pause", ({ params }) => Effect.flatMap(Cleanup, (c) => c.command(params.id, "pause")))
    .handle("resume", ({ params }) =>
      Effect.flatMap(Cleanup, (c) => c.command(params.id, "resume")),
    )
    .handle("stop", ({ params }) => Effect.flatMap(Cleanup, (c) => c.command(params.id, "stop")))
    .handle("return", ({ params }) =>
      Effect.flatMap(Cleanup, (c) => c.command(params.id, "return")),
    )
    .handle("close", ({ params }) => Effect.flatMap(Cleanup, (c) => c.command(params.id, "close")))
    .handle("skip", ({ params }) => Effect.flatMap(Cleanup, (c) => c.skip(params.id)))
    .handle("keep", ({ params, payload }) =>
      Effect.flatMap(Cleanup, (c) => c.keep(params.id, payload.itemIds)),
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
  Layer.provide([
    HealthLive,
    JobsLive,
    InventoryLive,
    ItemsApiLive,
    GuardianLive,
    BuildsLive,
    AgentLive,
    CleanupApiLive,
    AuthLive,
  ]),
  Layer.merge(HttpApiScalar.layer(GhostApi, { path: "/docs" })),
)
