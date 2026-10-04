import { Effect, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { BungieClient } from "../bungie/client.ts"
import { ItemsRepo } from "../db/items.ts"

// These are the tools Claude sees. Each one is a thin, typed wrapper over the
// Bungie client: the schema documents the parameters for the model and
// validates what it sends back, and the handler never does more than one
// Bungie call so the model composes the workflow instead of us hard-coding it.

const Json = Schema.String

const GetMemberships = Tool.make("get_memberships", {
  description:
    "Bungie memberships for the linked account. Use it to find membershipType and membershipId.",
  success: Json,
})

const GetProfile = Tool.make("get_profile", {
  description:
    "Destiny 2 profile. components defaults to characters, inventories, equipment, item instances and item stats.",
  parameters: Schema.Struct({
    membershipType: Schema.Number,
    membershipId: Schema.String,
    components: Schema.optional(Schema.Array(Schema.Number)),
  }),
  success: Json,
})

const TransferItem = Tool.make("transfer_item", {
  description: "Move an item between a character and the vault.",
  parameters: Schema.Struct({
    itemReferenceHash: Schema.Number,
    itemId: Schema.String,
    characterId: Schema.String,
    membershipType: Schema.Number,
    transferToVault: Schema.Boolean,
    stackSize: Schema.optional(Schema.Number),
  }),
  success: Json,
})

const PullFromPostmaster = Tool.make("pull_from_postmaster", {
  description: "Pull an item from a character's postmaster into that character's inventory.",
  parameters: Schema.Struct({
    itemReferenceHash: Schema.Number,
    itemId: Schema.String,
    characterId: Schema.String,
    membershipType: Schema.Number,
    stackSize: Schema.optional(Schema.Number),
  }),
  success: Json,
})

const RecordSeenItems = Tool.make("record_seen_items", {
  description:
    "Record item instances you touched (for example, items just pulled from the postmaster) so the app can show them as recently acquired.",
  parameters: Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        itemInstanceId: Schema.String,
        itemHash: Schema.Number,
        name: Schema.NullOr(Schema.String),
        location: Schema.Literals(["postmaster", "character", "vault"]),
      }),
    ),
  }),
  success: Schema.Number,
})

export const GhostToolkit = Toolkit.make(
  GetMemberships,
  GetProfile,
  TransferItem,
  PullFromPostmaster,
  RecordSeenItems,
)

const DEFAULT_COMPONENTS = [100, 102, 200, 201, 205, 300, 304]

const json = (value: unknown) => JSON.stringify(value)

export const GhostToolkitHandlers = GhostToolkit.toLayer(
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const items = yield* ItemsRepo
    return {
      get_memberships: () =>
        bungie.get("/User/GetMembershipsForCurrentUser/").pipe(Effect.map(json), Effect.orDie),
      get_profile: ({ membershipType, membershipId, components }) =>
        bungie
          .get(
            `/Destiny2/${membershipType}/Profile/${membershipId}/?components=${(components ?? DEFAULT_COMPONENTS).join(",")}`,
          )
          .pipe(Effect.map(json), Effect.orDie),
      transfer_item: (input) => bungie.transferItem(input).pipe(Effect.map(json), Effect.orDie),
      pull_from_postmaster: (input) =>
        bungie.pullFromPostmaster(input).pipe(Effect.map(json), Effect.orDie),
      record_seen_items: ({ items: seen }) =>
        items.markSeen(seen).pipe(Effect.as(seen.length), Effect.orDie),
    }
  }),
)
