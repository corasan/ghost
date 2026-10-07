import type { BungieNotLinked } from "@ghost/contract"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { ItemsRepo } from "../db/items.ts"
import { Wishlist } from "../wishlist/wishlist.ts"
import { BungieClient, type BungieError } from "./client.ts"
import {
  buildInventory,
  type Inventory,
  PROFILE_COMPONENTS,
  Profile,
  profileHashes,
} from "./inventory.ts"
import { Manifest } from "./manifest.ts"
import { setsByItem } from "./sets.ts"
import { PlugSets } from "./subclass.ts"

// One GetProfile call feeds every screen and agent tool. It is cached for 30
// seconds so a burst of requests (the app refetching, the agent searching)
// costs one Bungie round trip, and invalidated after anything moves.

const Memberships = Schema.Struct({
  primaryMembershipId: Schema.optional(Schema.String),
  destinyMemberships: Schema.Array(
    Schema.Struct({ membershipId: Schema.String, membershipType: Schema.Number }),
  ),
})

interface Membership {
  readonly membershipId: string
  readonly membershipType: number
}

export interface ProfileStoreService {
  readonly inventory: Effect.Effect<Inventory, BungieError | BungieNotLinked>
  /** What each character can slot on its subclasses, read from the same profile response as the inventory. */
  readonly plugSets: Effect.Effect<PlugSets, BungieError | BungieNotLinked>
  readonly invalidate: Effect.Effect<void>
}

export class ProfileStore extends Context.Service<ProfileStore, ProfileStoreService>()(
  "ProfileStore",
) {}

export const ProfileStoreLive = Layer.effect(
  ProfileStore,
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const manifest = yield* Manifest
    const items = yield* ItemsRepo
    const membershipRef = yield* Ref.make<Membership | null>(null)

    const decodeFailure = (cause: unknown) =>
      Effect.die(new Error(`unexpected Bungie response: ${String(cause)}`))

    // Memberships never change for an account, so one successful lookup is enough.
    const membership = Effect.gen(function* () {
      const known = yield* Ref.get(membershipRef)
      if (known !== null) return known
      const raw = yield* bungie.get("/User/GetMembershipsForCurrentUser/")
      const me = yield* Schema.decodeUnknownEffect(Memberships)(raw).pipe(
        Effect.catch(decodeFailure),
      )
      const found =
        me.destinyMemberships.find((m) => m.membershipId === me.primaryMembershipId) ??
        me.destinyMemberships[0]
      if (found === undefined) {
        return yield* Effect.die(new Error("no Destiny memberships on this account"))
      }
      yield* Ref.set(membershipRef, found)
      return found
    })

    const load = Effect.gen(function* () {
      const m = yield* membership
      const raw = yield* bungie.get(
        `/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${PROFILE_COMPONENTS.join(",")}`,
      )
      const profile = yield* Schema.decodeUnknownEffect(Profile)(raw).pipe(
        Effect.catch(decodeFailure),
      )
      const plugSets = yield* Schema.decodeUnknownEffect(PlugSets)(raw).pipe(
        Effect.catch(decodeFailure),
      )
      const defs = yield* manifest.lookup(profileHashes(profile))
      const sets = setsByItem(yield* manifest.armorSets)
      const tuning = yield* manifest.tuningMods
      // Sync needs the item list and the summaries need what sync wrote
      // (first-seen times), so the pure build runs twice; it is cheap.
      const draft = buildInventory(profile, defs, new Map(), sets, tuning)
      yield* items.sync(draft.items).pipe(Effect.orDie)
      const seen = yield* items.decisions.pipe(Effect.orDie)
      const inventory = {
        ...buildInventory(profile, defs, seen, sets, tuning),
        membershipType: m.membershipType,
        membershipId: m.membershipId,
      }
      return { inventory, plugSets }
    })

    const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(load, "30 seconds")
    // A failure (not linked yet, Bungie down) must not stick for 30 seconds.
    const loaded = cached.pipe(Effect.tapError(() => invalidate))
    const inventory = Effect.map(loaded, (profile) => profile.inventory)
    const plugSets = Effect.map(loaded, (profile) => profile.plugSets)

    return { inventory, plugSets, invalidate }
  }),
)

// Keeps first-seen times accurate while the player is in game and the app is
// closed: without it a drop would only be noticed on the next app open.
// The wishlist check rides along; it is a no-op until 12 hours have passed.
const refreshLoop = Effect.gen(function* () {
  const bungie = yield* BungieClient
  const profile = yield* ProfileStore
  const wishlist = yield* Wishlist
  yield* wishlist.ensure.pipe(
    Effect.catch((e) => Effect.logWarning(`wishlist refresh failed: ${e.message}`)),
  )
  if (!(yield* bungie.isLinked)) return
  yield* profile.invalidate
  yield* profile.inventory.pipe(
    Effect.catch((e) => Effect.logWarning(`background profile refresh failed: ${e._tag}`)),
  )
}).pipe(
  Effect.catchCause((cause) => Effect.logDebug("background refresh failed", cause)),
  Effect.andThen(Effect.sleep("10 minutes")),
  Effect.forever,
)

export const ProfileRefreshLive = Layer.effectDiscard(Effect.forkScoped(refreshLoop))
