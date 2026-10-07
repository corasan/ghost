import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ItemsRepo } from "../db/items.ts"
import { BungieClient } from "./client.ts"
import { Manifest } from "./manifest.ts"
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

const bungie = Layer.mock(BungieClient, {
  get: (path) => {
    if (path.startsWith("/User/"))
      return Effect.succeed({
        primaryMembershipId: "4611686018467260757",
        destinyMemberships: [{ membershipId: "4611686018467260757", membershipType: 3 }],
      })
    const components = new URL(path, "https://www.bungie.net").searchParams.get("components") ?? ""
    return Effect.succeed(
      Object.assign(
        { responseMintedTimestamp: "2026-10-05T21:30:34.085Z" },
        ...components.split(",").map((component) => sections.get(component) ?? {}),
      ),
    )
  },
})

const manifest = Layer.mock(Manifest, {
  lookup: () => Effect.succeed(new Map()),
  armorSets: Effect.succeed([]),
  tuningMods: Effect.succeed(new Map()),
})
const items = Layer.mock(ItemsRepo, {
  sync: () => Effect.void,
  decisions: Effect.succeed(new Map()),
})

const store = ProfileStoreLive.pipe(Layer.provide(Layer.mergeAll(bungie, manifest, items)))

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
