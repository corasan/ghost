import {
  type BungieNotLinked,
  CharacterStats,
  GuardianCharacter,
  type GuardianClass,
  GuardianSnapshot,
  ItemSummary,
  VaultSnapshot,
} from "@ghost/contract"
import { Context, Effect, Layer, Schema } from "effect"
import { BungieClient, type BungieError } from "./client.ts"
import { BUCKETS, damageForType, Manifest, type ManifestItem, slotForBucket } from "./manifest.ts"

// Reads the linked account's profile and turns Bungie's component soup into
// the two shapes the app renders: a per-character summary and the vault.
// One GetProfile call returns everything; we ask for exactly the components
// we use so the response stays small.

const VAULT_CAPACITY = 700

// Profile components: 100 profile, 102 profile inventory (vault), 200
// characters, 201 character inventories (incl. postmaster), 205 equipment,
// 300 item instances (power, damage type).
const COMPONENTS = [100, 102, 200, 201, 205, 300]

const Memberships = Schema.Struct({
  primaryMembershipId: Schema.optional(Schema.String),
  destinyMemberships: Schema.Array(
    Schema.Struct({ membershipId: Schema.String, membershipType: Schema.Number }),
  ),
})

const RawItem = Schema.Struct({
  itemHash: Schema.Number,
  itemInstanceId: Schema.optional(Schema.String),
  quantity: Schema.Number,
  bucketHash: Schema.Number,
})
type RawItem = typeof RawItem.Type

const Instance = Schema.Struct({
  damageType: Schema.optional(Schema.Number),
  primaryStat: Schema.optional(Schema.Struct({ value: Schema.Number })),
})

const Character = Schema.Struct({
  characterId: Schema.String,
  classType: Schema.Number,
  light: Schema.Number,
  stats: Schema.Record(Schema.String, Schema.Number),
})

const ItemList = Schema.Struct({ items: Schema.Array(RawItem) })

const Profile = Schema.Struct({
  profileInventory: Schema.optional(Schema.Struct({ data: Schema.optional(ItemList) })),
  characters: Schema.optional(
    Schema.Struct({ data: Schema.optional(Schema.Record(Schema.String, Character)) }),
  ),
  characterInventories: Schema.optional(
    Schema.Struct({ data: Schema.optional(Schema.Record(Schema.String, ItemList)) }),
  ),
  characterEquipment: Schema.optional(
    Schema.Struct({ data: Schema.optional(Schema.Record(Schema.String, ItemList)) }),
  ),
  itemComponents: Schema.optional(
    Schema.Struct({
      instances: Schema.optional(
        Schema.Struct({ data: Schema.optional(Schema.Record(Schema.String, Instance)) }),
      ),
    }),
  ),
})
type Profile = typeof Profile.Type

const STAT = {
  mobility: "2996146975",
  resilience: "392767087",
  recovery: "1943323491",
  discipline: "1735777505",
  intellect: "144602215",
  strength: "4244567218",
} as const

const classFor = (classType: number): GuardianClass =>
  classType === 0 ? "titan" : classType === 1 ? "hunter" : "warlock"

export interface GuardianShape {
  readonly snapshot: Effect.Effect<GuardianSnapshot, BungieError | BungieNotLinked>
  readonly vault: Effect.Effect<VaultSnapshot, BungieError | BungieNotLinked>
}

export class Guardian extends Context.Service<Guardian, GuardianShape>()("Guardian") {}

export const GuardianLive = Layer.effect(
  Guardian,
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const manifest = yield* Manifest

    const decodeFailure = (error: unknown) =>
      Effect.die(new Error(`unexpected Bungie response: ${String(error)}`))

    const loadProfile = Effect.gen(function* () {
      const raw = yield* bungie.get("/User/GetMembershipsForCurrentUser/")
      const me = yield* Schema.decodeUnknownEffect(Memberships)(raw).pipe(
        Effect.catch(decodeFailure),
      )
      const membership =
        me.destinyMemberships.find((m) => m.membershipId === me.primaryMembershipId) ??
        me.destinyMemberships[0]
      if (membership === undefined) {
        return yield* Effect.die(new Error("no Destiny memberships on this account"))
      }
      const profileRaw = yield* bungie.get(
        `/Destiny2/${membership.membershipType}/Profile/${membership.membershipId}/?components=${COMPONENTS.join(",")}`,
      )
      return yield* Schema.decodeUnknownEffect(Profile)(profileRaw).pipe(
        Effect.catch(decodeFailure),
      )
    })

    const summarize =
      (profile: Profile, defs: ReadonlyMap<number, ManifestItem>) =>
      (item: RawItem): ItemSummary => {
        const def = defs.get(item.itemHash)
        const instance =
          item.itemInstanceId === undefined
            ? undefined
            : profile.itemComponents?.instances?.data?.[item.itemInstanceId]
        // Vault items all sit in the "general" bucket, so the slot comes
        // from the definition; equipped items carry their real bucket.
        const bucket = item.bucketHash === BUCKETS.vault ? (def?.bucketHash ?? 0) : item.bucketHash
        return new ItemSummary({
          itemInstanceId: item.itemInstanceId ?? null,
          itemHash: item.itemHash,
          name: def?.name ?? `#${item.itemHash}`,
          typeName: def?.typeName ?? "",
          icon: def?.icon ?? null,
          tier: def?.tier ?? "unknown",
          slot: slotForBucket(bucket),
          damageType:
            instance?.damageType !== undefined
              ? damageForType(instance.damageType)
              : (def?.damageType ?? "none"),
          power: instance?.primaryStat?.value ?? null,
          quantity: item.quantity,
        })
      }

    const vaultItems = (profile: Profile) =>
      (profile.profileInventory?.data?.items ?? []).filter((i) => i.bucketHash === BUCKETS.vault)

    const snapshot = Effect.gen(function* () {
      const profile = yield* loadProfile
      const characters = Object.values(profile.characters?.data ?? {})
      const equipment = profile.characterEquipment?.data ?? {}
      const inventories = profile.characterInventories?.data ?? {}
      const hashes = characters.flatMap((c) =>
        (equipment[c.characterId]?.items ?? []).map((i) => i.itemHash),
      )
      const defs = yield* manifest.lookup(hashes)
      const toSummary = summarize(profile, defs)
      return new GuardianSnapshot({
        characters: characters
          .sort((a, b) => b.light - a.light)
          .map(
            (c) =>
              new GuardianCharacter({
                characterId: c.characterId,
                classType: classFor(c.classType),
                light: c.light,
                stats: new CharacterStats({
                  mobility: c.stats[STAT.mobility] ?? 0,
                  resilience: c.stats[STAT.resilience] ?? 0,
                  recovery: c.stats[STAT.recovery] ?? 0,
                  discipline: c.stats[STAT.discipline] ?? 0,
                  intellect: c.stats[STAT.intellect] ?? 0,
                  strength: c.stats[STAT.strength] ?? 0,
                }),
                equipment: (equipment[c.characterId]?.items ?? [])
                  .map(toSummary)
                  .filter((i) => i.slot !== "other"),
                postmasterCount: (inventories[c.characterId]?.items ?? []).filter(
                  (i) => i.bucketHash === BUCKETS.postmaster,
                ).length,
              }),
          ),
        vaultCount: vaultItems(profile).length,
        vaultCapacity: VAULT_CAPACITY,
      })
    })

    const vault = Effect.gen(function* () {
      const profile = yield* loadProfile
      const items = vaultItems(profile)
      const defs = yield* manifest.lookup(items.map((i) => i.itemHash))
      const toSummary = summarize(profile, defs)
      return new VaultSnapshot({
        count: items.length,
        capacity: VAULT_CAPACITY,
        items: items.map(toSummary).sort((a, b) => (b.power ?? 0) - (a.power ?? 0)),
      })
    })

    return { snapshot, vault }
  }),
)
