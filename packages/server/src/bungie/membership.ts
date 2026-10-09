import type { BungieNotLinked } from "@ghost/contract"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Settings } from "../db/settings.ts"
import { BungieClient, type BungieError, MEMBERSHIP_KEY } from "./client.ts"

// The Destiny account Ghost acts on. A membership never changes for an
// account, so it is looked up once and kept in settings. The client forgets
// it whenever the tokens change, since a new sign-in may be another account.

const Memberships = Schema.Struct({
  primaryMembershipId: Schema.optional(Schema.String),
  destinyMemberships: Schema.Array(
    Schema.Struct({ membershipId: Schema.String, membershipType: Schema.Number }),
  ),
})

const DestinyMembership = Schema.Struct({
  membershipId: Schema.String,
  membershipType: Schema.Number,
})
export type DestinyMembership = typeof DestinyMembership.Type

const decodeStored = Schema.decodeOption(Schema.fromJsonString(DestinyMembership))

export interface MembershipService {
  readonly current: Effect.Effect<DestinyMembership, BungieError | BungieNotLinked>
}

export class Membership extends Context.Service<Membership, MembershipService>()("Membership") {}

export const MembershipLive = Layer.effect(
  Membership,
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const settings = yield* Settings

    const current = Effect.gen(function* () {
      const stored = (yield* settings.get(MEMBERSHIP_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(decodeStored),
      )
      if (Option.isSome(stored)) return stored.value
      const raw = yield* bungie.get("/User/GetMembershipsForCurrentUser/")
      const me = yield* Schema.decodeUnknownEffect(Memberships)(raw).pipe(
        Effect.catch((cause) =>
          Effect.die(new Error(`unexpected Bungie response: ${String(cause)}`)),
        ),
      )
      const found =
        me.destinyMemberships.find((m) => m.membershipId === me.primaryMembershipId) ??
        me.destinyMemberships[0]
      if (found === undefined) {
        return yield* Effect.die(new Error("no Destiny memberships on this account"))
      }
      const membership: DestinyMembership = {
        membershipId: found.membershipId,
        membershipType: found.membershipType,
      }
      yield* settings.set(MEMBERSHIP_KEY, JSON.stringify(membership)).pipe(Effect.orDie)
      return membership
    })

    return { current }
  }),
)
