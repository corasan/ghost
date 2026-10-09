import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { ItemsRepo } from "../db/items.ts"
import { BungieClient } from "./client.ts"
import { Manifest } from "./manifest.ts"
import { Membership } from "./membership.ts"
import { ProfileStore, ProfileStoreLive } from "./profile.ts"
import { unlockedPlugs } from "./subclass.ts"

const CHARACTER = "2305843009309769093"
const SENTINEL_ASPECTS = 1369926501
const unlocked = (plugItemHash: number) => ({ plugItemHash, canInsert: true, enabled: true })

const sections = new Map(
  Object.entries({
    100: {
      profile: { data: { userInfo: { membershipType: 3, membershipId: "4611686018467260757" } } },
    },
    104: { profileProgression: { data: { checklists: {} }, privacy: 1 } },
    305: {
      profilePlugSets: {
        data: {
          plugs: {
            [SENTINEL_ASPECTS]: [662916127, 1602994568, 1602994569, 1602994570, 1602994571].map(
              unlocked,
            ),
          },
        },
      },
      characterPlugSets: {
        data: { [CHARACTER]: { plugs: { 1445506784: [unlocked(2031919264)] } } },
      },
      itemComponents: { sockets: { data: {} } },
    },
  }),
)

const membership = Layer.mock(Membership, {
  current: Effect.succeed({ membershipId: "4611686018467260757", membershipType: 3 }),
})

const answer = (path: string) => {
  const components = new URL(path, "https://www.bungie.net").searchParams.get("components") ?? ""
  return Effect.succeed(
    Object.assign(
      { responseMintedTimestamp: "2026-10-05T21:30:34.085Z" },
      ...components.split(",").map((component) => sections.get(component) ?? {}),
    ),
  )
}

const bungie = Layer.mock(BungieClient, { get: answer })

const manifest = Layer.mock(Manifest, {
  lookup: () => Effect.succeed(new Map()),
  armorSets: Effect.succeed([]),
  tuningMods: Effect.succeed(new Map()),
})
const items = Layer.mock(ItemsRepo, {
  sync: () => Effect.void,
  decisions: Effect.succeed(new Map()),
})

const store = ProfileStoreLive.pipe(
  Layer.provide(Layer.mergeAll(bungie, manifest, items, membership)),
)

describe("ProfileStore.plugSets", () => {
  test("reads the plug sets Bungie sends with the item sockets component", async () => {
    const sets = await Effect.runPromise(
      Effect.flatMap(ProfileStore, (profile) => profile.plugSets).pipe(Effect.provide(store)),
    )
    expect(unlockedPlugs(sets, CHARACTER, SENTINEL_ASPECTS)).toEqual([
      662916127, 1602994568, 1602994569, 1602994570, 1602994571,
    ])
    expect(unlockedPlugs(sets, CHARACTER, 1445506784)).toEqual([2031919264])
  })
})

describe("ProfileStore.invalidate", () => {
  test("drops a load that was in flight when it ran, instead of caching it", async () => {
    let loads = 0
    let gate: Deferred.Deferred<void> | undefined
    const counting = Layer.mock(BungieClient, {
      get: (path) => {
        loads += 1
        const held = gate
        return held === undefined
          ? answer(path)
          : Deferred.await(held).pipe(Effect.andThen(answer(path)))
      },
    })
    const counted = ProfileStoreLive.pipe(
      Layer.provide(Layer.mergeAll(counting, manifest, items, membership)),
    )
    const total = await Effect.gen(function* () {
      const profile = yield* ProfileStore
      const held = yield* Deferred.make<void>()
      gate = held
      const first = yield* Effect.forkChild(profile.inventory)
      while (loads === 0) yield* Effect.yieldNow
      yield* profile.invalidate
      gate = undefined
      yield* Deferred.succeed(held, undefined)
      yield* Fiber.join(first)
      yield* profile.inventory
      return loads
    }).pipe(Effect.provide(counted), Effect.runPromise)
    expect(total).toBe(2)
  })
})
