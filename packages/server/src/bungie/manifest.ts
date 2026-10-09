import type { DamageType, ItemSlot, ItemTier } from "@ghost/contract"
import { Context, Effect, Layer, Option, Redacted, Schema, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../config.ts"
import { Settings } from "../db/settings.ts"
import { BungieError, PLATFORM_TIMEOUT, readEnvelope, retryPolicy, timeoutAfter } from "./client.ts"

// Bungie's API only ever gives you item *hashes*. Names, tiers, and slots
// live in the "manifest", a set of JSON blobs published with every game
// patch. We download the lite item definitions once (roughly 30 MB), keep the
// handful of fields we need in SQLite, and refresh when Bungie's version
// string changes. Lookups are then a local query, not a network call per item.
// The version check itself runs at most hourly, and looked-up definitions stay
// in memory, so a profile load does not touch the network or SQLite for them.

export interface ManifestItem {
  readonly hash: number
  readonly name: string
  readonly typeName: string
  readonly icon: string | null
  readonly tier: ItemTier
  readonly slot: ItemSlot
  readonly damageType: DamageType
  readonly bucketHash: number
  /** Bungie's DestinyClass: 0 titan, 1 hunter, 2 warlock, 3 any. */
  readonly classType: number
  /** Effect text from the current patch, for perks, mods and fragments. */
  readonly description: string
}

export interface Capacities {
  readonly vault: number
  readonly postmaster: number
}

const StoredCapacities = Schema.Struct({
  vault: Schema.optionalKey(Schema.Number),
  postmaster: Schema.optionalKey(Schema.Number),
})

/** Used only until Bungie's bucket definitions have been read once. */
export const FALLBACK_CAPACITIES: Capacities = { vault: 700, postmaster: 21 }

const BucketDefinition = Schema.Struct({ itemCount: Schema.optionalKey(Schema.Number) })
type BucketDefinition = typeof BucketDefinition.Type

export const capacitiesFrom = (
  buckets: Readonly<Record<string, BucketDefinition | undefined>>,
): Capacities => ({
  vault: buckets[BUCKETS.vault]?.itemCount || FALLBACK_CAPACITIES.vault,
  postmaster: buckets[BUCKETS.postmaster]?.itemCount || FALLBACK_CAPACITIES.postmaster,
})

/** Name, effect and icon URL of an armor stat in the current patch, keyed by stat hash. */
const StatFacts = Schema.Record(
  Schema.String,
  Schema.Struct({
    name: Schema.String,
    effect: Schema.String,
    icon: Schema.optionalKey(Schema.String),
  }),
)
export type StatFacts = typeof StatFacts.Type

const StatDefinition = Schema.Struct({
  displayProperties: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      icon: Schema.optionalKey(Schema.String),
    }),
  ),
})
type StatDefinition = typeof StatDefinition.Type

export const statFactsFrom = (
  definitions: Readonly<Record<string, StatDefinition | undefined>>,
  hashes: ReadonlyArray<string>,
): StatFacts =>
  Object.fromEntries(
    hashes.flatMap((hash) => {
      const display = definitions[hash]?.displayProperties
      const name = display?.name
      if (name === undefined || name === "") return []
      const icon = display?.icon ? { icon: `https://www.bungie.net${display.icon}` } : {}
      return [[hash, { name, effect: display?.description ?? "", ...icon }]]
    }),
  )

/** What a plug adds to or takes from each armor stat, keyed by stat hash. */
const StatMods = Schema.Record(Schema.String, Schema.Number)
export type StatMods = typeof StatMods.Type

const optionalNumber = Schema.optionalKey(Schema.Number)
const optionalString = Schema.optionalKey(Schema.String)

const PlugDefinition = Schema.Struct({
  displayProperties: Schema.optionalKey(
    Schema.Struct({ name: optionalString, description: optionalString, icon: optionalString }),
  ),
  investmentStats: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        statTypeHash: optionalNumber,
        value: optionalNumber,
        isConditionallyActive: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
  plug: Schema.optionalKey(
    Schema.Struct({
      plugCategoryIdentifier: optionalString,
      energyCapacity: Schema.optionalKey(Schema.Struct({ capacityValue: optionalNumber })),
      energyCost: Schema.optionalKey(Schema.Struct({ energyCost: optionalNumber })),
      insertionRules: Schema.optionalKey(
        Schema.Array(Schema.Struct({ failureMessage: optionalString })),
      ),
    }),
  ),
  perks: Schema.optionalKey(Schema.Array(Schema.Struct({ perkHash: optionalNumber }))),
  traitHashes: Schema.optionalKey(Schema.Array(Schema.Number)),
  sockets: Schema.optionalKey(
    Schema.Struct({
      socketEntries: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            reusablePlugSetHash: optionalNumber,
            randomizedPlugSetHash: optionalNumber,
          }),
        ),
      ),
      socketCategories: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            socketCategoryHash: optionalNumber,
            socketIndexes: Schema.optionalKey(Schema.Array(Schema.Number)),
          }),
        ),
      ),
    }),
  ),
})
export type PlugDefinition = typeof PlugDefinition.Type

const PlugSetDefinition = Schema.Struct({
  reusablePlugItems: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        plugItemHash: Schema.Number,
        currentlyCanRoll: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
})

/** The socket category Bungie files a weapon's barrel, magazine, trait and origin sockets under. */
export const WEAPON_PERKS_CATEGORY = 4241085061

/** A weapon socket that slots perks, with every plug its perk pool can roll today. */
export interface PerkPool {
  readonly index: number
  readonly pool: ReadonlyArray<number>
}

/** Which sockets a weapon definition files as perks, with the plug set each one draws from. */
export const perkSocketsOf = (
  definition: PlugDefinition,
): ReadonlyArray<{ readonly index: number; readonly plugSetHash: number | null }> => {
  const entries = definition.sockets?.socketEntries ?? []
  const indexes =
    definition.sockets?.socketCategories?.find(
      (category) => category.socketCategoryHash === WEAPON_PERKS_CATEGORY,
    )?.socketIndexes ?? []
  return indexes.map((index) => ({
    index,
    plugSetHash:
      entries[index]?.randomizedPlugSetHash ?? entries[index]?.reusablePlugSetHash ?? null,
  }))
}

/** What a plug adds to or takes from each stat, weapon stats included, leaving out changes that only apply in some conditions. */
export const investmentOf = (definition: PlugDefinition): StatMods =>
  Object.fromEntries(
    (definition.investmentStats ?? []).flatMap((stat) =>
      stat.statTypeHash !== undefined && stat.value && !stat.isConditionallyActive
        ? [[String(stat.statTypeHash), stat.value]]
        : [],
    ),
  )

const KeywordFacts = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
})
export type KeywordFacts = typeof KeywordFacts.Type

/** Keywords by trait hash. */
const Keywords = Schema.Record(Schema.String, KeywordFacts)
export type Keywords = typeof Keywords.Type

const TraitDefinition = Schema.Struct({
  displayHint: optionalString,
  displayProperties: Schema.optionalKey(
    Schema.Struct({ name: optionalString, description: optionalString, icon: optionalString }),
  ),
})
type TraitDefinition = typeof TraitDefinition.Type

/** The traits the game shows as keywords in its tooltips, such as Weaken or Volatile. */
export const keywordsFrom = (
  definitions: Readonly<Record<string, TraitDefinition | undefined>>,
): Keywords =>
  Object.fromEntries(
    Object.entries(definitions).flatMap(([hash, definition]) => {
      const shown = definition?.displayProperties
      if (definition?.displayHint !== "keyword" || !shown?.name || !shown.description) return []
      return [
        [
          hash,
          {
            name: shown.name,
            description: shown.description,
            icon: shown.icon ? `https://www.bungie.net${shown.icon}` : null,
          },
        ],
      ]
    }),
  )

/** What the lite definitions leave out about a subclass plug. */
const PlugFacts = Schema.Struct({
  mods: StatMods,
  /** Changes Bungie marks conditional: of these, only the one to the wearer's class stat applies. */
  classMods: StatMods,
  /** Fragment slots an aspect brings; zero for anything else. */
  fragmentSlots: Schema.Number,
  /** Armor energy an armor mod takes; zero for anything else. */
  energyCost: Schema.Number,
  /** What kind of socket the plug fits; a mod goes where the socket's own plug has the same one. */
  category: Schema.String,
  /** Only usable while unlocked in the Seasonal Artifact. */
  artifact: Schema.Boolean,
  /** Its effect depends on the wearer holding Armor Charge. */
  charged: Schema.Boolean,
  description: Schema.String,
  /** The keywords Bungie tags the plug with, in the order it lists them. */
  keywords: Schema.Array(Schema.Struct(KeywordFacts.fields)),
})
export type PlugFacts = typeof PlugFacts.Type

/** An armor mod the player could slot, from the current patch. */
const ArmorModEntry = Schema.Struct({
  ...PlugFacts.fields,
  hash: Schema.Number,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
})
export type ArmorModEntry = typeof ArmorModEntry.Type

export const statModsFrom = (definition: PlugDefinition, conditional: boolean): StatMods =>
  Object.fromEntries(
    (definition.investmentStats ?? []).flatMap((stat) =>
      ARMOR_STAT_HASHES.includes(String(stat.statTypeHash)) &&
      stat.value &&
      (stat.isConditionallyActive ?? false) === conditional
        ? [[String(stat.statTypeHash), stat.value]]
        : [],
    ),
  )

export const TUNING_SOCKET = "core.gear_systems.armor_tiering.plugs.tuning.mods"

/** The stat hash each armor tuning mod raises, keyed by the mod's hash; null for Balanced Tuning, which raises none. */
export type TuningMods = ReadonlyMap<number, string | null>

const StoredTuningMods = Schema.Array(Schema.Tuple([Schema.Number, Schema.NullOr(Schema.String)]))

export const tuningModsFrom = (facts: ReadonlyMap<number, PlugFacts>): TuningMods =>
  new Map(
    [...facts].flatMap(([hash, plug]) =>
      plug.category === TUNING_SOCKET
        ? [[hash, Object.entries(plug.mods).find(([, value]) => value > 0)?.[0] ?? null] as const]
        : [],
    ),
  )

/** A bonus an armor set grants once enough of its pieces are worn. */
const ArmorSetPerk = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
  /** Pieces of the set the bonus needs. */
  required: Schema.Number,
})

/** An armor set from the current patch: the item hashes that belong to it and its bonuses. */
const ArmorSet = Schema.Struct({
  name: Schema.String,
  items: Schema.Array(Schema.Number),
  perks: Schema.Array(ArmorSetPerk),
})
export type ArmorSet = typeof ArmorSet.Type

const EquipableItemSetDefinition = Schema.Struct({
  displayProperties: Schema.optionalKey(Schema.Struct({ name: optionalString })),
  setItems: Schema.optionalKey(Schema.Array(Schema.Number)),
  setPerks: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ requiredSetCount: optionalNumber, sandboxPerkHash: optionalNumber }),
    ),
  ),
})
type EquipableItemSetDefinition = typeof EquipableItemSetDefinition.Type

export const armorSetsFrom = (
  definitions: Readonly<Record<string, EquipableItemSetDefinition | undefined>>,
  perks: ReadonlyMap<number, PlugDefinition>,
): ReadonlyArray<ArmorSet> =>
  Object.values(definitions).flatMap((definition) => {
    const name = definition?.displayProperties?.name ?? ""
    const resolved = (definition?.setPerks ?? []).flatMap((perk) => {
      const display =
        perk.sandboxPerkHash === undefined
          ? undefined
          : perks.get(perk.sandboxPerkHash)?.displayProperties
      return !display?.name || perk.requiredSetCount === undefined
        ? []
        : [
            {
              name: display.name,
              description: display.description ?? "",
              icon: display.icon ? `https://www.bungie.net${display.icon}` : null,
              required: perk.requiredSetCount,
            },
          ]
    })
    return name === "" || resolved.length === 0
      ? []
      : [{ name, items: definition?.setItems ?? [], perks: resolved }]
  })

/** Bungie's own icon for each damage type, as an absolute URL. */
export type ElementIcons = Partial<Record<DamageType, string>>

const DamageTypeDefinition = Schema.Struct({
  enumValue: optionalNumber,
  displayProperties: Schema.optionalKey(Schema.Struct({ icon: optionalString })),
})
type DamageTypeDefinition = typeof DamageTypeDefinition.Type

export const elementIconsFrom = (
  definitions: Readonly<Record<string, DamageTypeDefinition | undefined>>,
): ElementIcons =>
  Object.fromEntries(
    Object.values(definitions).flatMap((definition) => {
      const element = damageForType(definition?.enumValue ?? 0)
      const icon = definition?.displayProperties?.icon
      return element === "none" || !icon ? [] : [[element, `https://www.bungie.net${icon}`]]
    }),
  )

export interface ManifestService {
  /** What Bungie calls each armor stat and says it does. Empty until first read. Never fails. */
  readonly statFacts: Effect.Effect<StatFacts>
  /** Stat changes, fragment slots and effect text of subclass plugs. A plug Bungie cannot be asked about is left out. Never fails. */
  readonly plugFacts: (
    hashes: ReadonlyArray<number>,
  ) => Effect.Effect<ReadonlyMap<number, PlugFacts>>
  /** The plug set each socket of a subclass draws from, in socket order; null where it has none or Bungie cannot be asked. Never fails. */
  readonly subclassPlugSets: (hash: number) => Effect.Effect<ReadonlyArray<number | null>>
  /** Which of a weapon's sockets hold perks, in socket order. Empty when Bungie cannot be asked. Never fails. */
  readonly weaponPerkSockets: (itemHash: number) => Effect.Effect<ReadonlyArray<number>>
  /** A weapon's perk sockets in socket order, each with the plugs it can roll. Empty when Bungie cannot be asked. Never fails. */
  readonly weaponPerkPools: (itemHash: number) => Effect.Effect<ReadonlyArray<PerkPool>>
  /** What each plug adds to or takes from each stat, weapon stats included. A plug Bungie cannot be asked about is left out. Never fails. */
  readonly plugInvestments: (
    hashes: ReadonlyArray<number>,
  ) => Effect.Effect<ReadonlyMap<number, StatMods>>
  /** Every armor mod that fits a build socket. Slow the first time after a patch, then stored. Never fails. */
  readonly armorMods: Effect.Effect<ReadonlyArray<ArmorModEntry>>
  /** Armor sets with their bonuses resolved. Slow the first time after a patch, then stored. Never fails. */
  readonly armorSets: Effect.Effect<ReadonlyArray<ArmorSet>>
  /** Armor tuning mods by hash. Slow the first time after a patch, then stored. Empty when Bungie cannot be asked. Never fails. */
  readonly tuningMods: Effect.Effect<TuningMods>
  /** Empty until first read. Never fails. */
  readonly elementIcons: Effect.Effect<ElementIcons>
  /** How many slots the vault and postmaster hold in the current patch. Never fails. */
  readonly capacities: Effect.Effect<Capacities>
  /** Make sure the local copy exists and is current. Cheap when nothing changed. */
  readonly ensure: Effect.Effect<void, BungieError>
  readonly lookup: (
    hashes: Iterable<number>,
  ) => Effect.Effect<ReadonlyMap<number, ManifestItem>, BungieError>
  /**
   * Definitions whose name matches exactly (case-insensitive); several per name are common.
   * By default only ones with effect text, as plugs have; "any" also finds
   * weapons and armor, whose descriptions are empty.
   */
  readonly findByName: (
    names: ReadonlyArray<string>,
    kind?: "described" | "any",
  ) => Effect.Effect<ReadonlyArray<ManifestItem>, BungieError>
}

export class Manifest extends Context.Service<Manifest, ManifestService>()("Manifest") {}

// DestinyInventoryBucketDefinition hashes for the equipment slots we show.
export const BUCKETS = {
  kinetic: 1498876634,
  energy: 2465295065,
  power: 953998645,
  helmet: 3448274439,
  arms: 3551918588,
  chest: 14239492,
  legs: 20886954,
  class: 1585787867,
  postmaster: 215593132,
  vault: 138197802,
  subclass: 3284755031,
  ghost: 4023194814,
} as const

export const slotForBucket = (bucketHash: number): ItemSlot => {
  switch (bucketHash) {
    case BUCKETS.kinetic:
      return "kinetic"
    case BUCKETS.energy:
      return "energy"
    case BUCKETS.power:
      return "power"
    case BUCKETS.helmet:
      return "helmet"
    case BUCKETS.arms:
      return "arms"
    case BUCKETS.chest:
      return "chest"
    case BUCKETS.legs:
      return "legs"
    case BUCKETS.class:
      return "class"
    default:
      return "other"
  }
}

// Bungie's TierType enum: 2 basic, 3 common, 4 rare, 5 legendary, 6 exotic.
export const tierForType = (tierType: number): ItemTier => {
  switch (tierType) {
    case 6:
      return "exotic"
    case 5:
      return "legendary"
    case 4:
      return "rare"
    case 3:
    case 2:
      return "common"
    default:
      return "unknown"
  }
}

// Bungie's DamageType enum. 5 (raid) is unused for weapons.
export const damageForType = (damageType: number): DamageType => {
  switch (damageType) {
    case 1:
      return "kinetic"
    case 2:
      return "arc"
    case 3:
      return "solar"
    case 4:
      return "void"
    case 6:
      return "stasis"
    case 7:
      return "strand"
    default:
      return "none"
  }
}

type ManifestRow = {
  readonly hash: number
  readonly name: string
  readonly type_name: string
  readonly icon: string | null
  readonly tier_type: number
  readonly bucket_hash: number
  readonly item_type: number
  readonly damage_type: number
  readonly class_type: number
  readonly description: string | null
}

const rowToItem = (row: ManifestRow): ManifestItem => ({
  hash: row.hash,
  name: row.name,
  typeName: row.type_name,
  icon: row.icon === null ? null : `https://www.bungie.net${row.icon}`,
  tier: tierForType(row.tier_type),
  slot: slotForBucket(row.bucket_hash),
  damageType: damageForType(row.damage_type),
  bucketHash: row.bucket_hash,
  classType: row.class_type,
  description: row.description ?? "",
})

const LiteDefinition = Schema.Struct({
  displayProperties: Schema.optionalKey(
    Schema.Struct({ name: optionalString, icon: optionalString, description: optionalString }),
  ),
  itemTypeDisplayName: optionalString,
  itemType: optionalNumber,
  defaultDamageType: optionalNumber,
  classType: optionalNumber,
  talentGrid: Schema.optionalKey(Schema.Struct({ hudDamageType: optionalNumber })),
  inventory: Schema.optionalKey(
    Schema.Struct({ tierType: optionalNumber, bucketTypeHash: optionalNumber }),
  ),
})

const ManifestIndex = Schema.Struct({
  version: Schema.String,
  jsonWorldComponentContentPaths: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, Schema.String),
  ),
})
type ManifestIndex = typeof ManifestIndex.Type

const LiteDefinitions = Schema.Record(Schema.String, LiteDefinition)
const decodePlug = Schema.decodeUnknownEffect(PlugDefinition)
const decodePlugSet = Schema.decodeUnknownEffect(PlugSetDefinition)
const decodeIndex = Schema.decodeUnknownEffect(ManifestIndex)
const StoredElementIcons = Schema.Record(Schema.String, Schema.String)

const definitionsOf = <S extends Schema.Top>(definition: S) =>
  Schema.Record(Schema.String, definition)

const storedJson = <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  Schema.decodeOption(Schema.fromJsonString(schema))

const VERSION_KEY = "manifest.version"
const CAPACITIES_KEY = "manifest.capacities"
const CAPACITIES_VERSION_KEY = "manifest.capacities.version"
const STAT_FACTS_KEY = "manifest.statFacts.v2"
const STAT_FACTS_VERSION_KEY = "manifest.statFacts.v2.version"
const ARMOR_MODS_KEY = "manifest.armorMods.v3"
const ARMOR_MODS_VERSION_KEY = "manifest.armorMods.version"
const ARMOR_SETS_KEY = "manifest.armorSets"
const ARMOR_SETS_VERSION_KEY = "manifest.armorSets.version"
const TUNING_MODS_KEY = "manifest.tuningMods"
const TUNING_MODS_VERSION_KEY = "manifest.tuningMods.version"
export const BUILD_SOCKET = /^enhancements\.v2_/

const ARMOR_CHARGE = /armor charge/i

/**
 * An armor charge mod's own text is the same "gain Armor Charge" line on
 * every one of them; what the mod does with the charge is in its perk.
 */
export const modDescription = (itemText: string, facts: PlugFacts) =>
  facts.charged ? facts.description : itemText || facts.description
const ELEMENT_ICONS_KEY = "manifest.elementIcons"
const ELEMENT_ICONS_VERSION_KEY = "manifest.elementIcons.version"
const KEYWORDS_KEY = "manifest.keywords"
const KEYWORDS_VERSION_KEY = "manifest.keywords.version"
const ARMOR_STAT_HASHES = [
  "2996146975",
  "392767087",
  "1943323491",
  "1735777505",
  "144602215",
  "4244567218",
]
const BATCH = 500
const CHECK_EVERY_MS = 60 * 60 * 1000
/** After a failed version check with a usable local copy, try again this soon. */
const RECHECK_AFTER_FAILURE_MS = 5 * 60 * 1000
/** The definition files run to tens of megabytes. */
const CONTENT_TIMEOUT = "5 minutes"
/** Per-hash Platform calls in flight at once, well under Bungie's rate limit. */
const FAN_OUT = 4
const MAX_PLUG_FAILURES = 3

export const ManifestLive = Layer.effect(
  Manifest,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const settings = yield* Settings
    const sql = yield* SqlClient.SqlClient
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("X-API-Key", Redacted.value(config.bungie.apiKey)),
      ),
    )

    const transport = (cause: unknown) =>
      new BungieError({ status: "Transport", message: String(cause) })

    /** A definition file from the CDN; plain JSON, not an envelope. */
    const fetchJson = <S extends Schema.Constraint>(url: string, schema: S) =>
      http
        .get(url)
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          Effect.mapError(transport),
          timeoutAfter(CONTENT_TIMEOUT),
          Effect.retry(retryPolicy(true)),
        )

    /** The `Response` of a public Platform endpoint. A Bungie error code fails it, so nothing below caches one. */
    const platform = (path: string) =>
      http
        .get(`https://www.bungie.net/Platform${path}`)
        .pipe(
          Effect.mapError(transport),
          Effect.flatMap(readEnvelope),
          timeoutAfter(PLATFORM_TIMEOUT),
          Effect.retry(retryPolicy(true)),
        )

    const manifestIndex = platform("/Destiny2/Manifest/").pipe(
      Effect.flatMap((raw) => decodeIndex(raw).pipe(Effect.mapError(transport))),
    )

    const replaceAll = (definitions: typeof LiteDefinitions.Type) =>
      Effect.gen(function* () {
        const rows: Array<ManifestRow> = []
        // The lite definitions carry no `hash` field; the object key is the hash.
        for (const [key, def] of Object.entries(definitions)) {
          const hash = Number(key)
          const name = def.displayProperties?.name ?? ""
          if (!Number.isInteger(hash) || name === "") continue
          rows.push({
            hash,
            name,
            type_name: def.itemTypeDisplayName ?? "",
            icon: def.displayProperties?.icon ?? null,
            tier_type: def.inventory?.tierType ?? 0,
            bucket_hash: def.inventory?.bucketTypeHash ?? 0,
            item_type: def.itemType ?? 0,
            // Subclasses carry their element on the talent grid instead.
            damage_type: def.defaultDamageType || (def.talentGrid?.hudDamageType ?? 0),
            class_type: def.classType ?? 3,
            description: def.displayProperties?.description || null,
          })
        }
        yield* sql`DELETE FROM manifest_items`
        for (let i = 0; i < rows.length; i += BATCH) {
          yield* sql`INSERT INTO manifest_items ${sql.insert(rows.slice(i, i + BATCH))}`
        }
        return rows.length
      }).pipe(sql.withTransaction)

    const cache = new Map<number, ManifestItem>()
    const missing = new Set<number>()
    let checkedAt = 0
    // Two lookups racing at startup would otherwise both download the manifest.
    const lock = yield* Semaphore.make(1)
    const lockMods = yield* Semaphore.make(1)
    const lockSets = yield* Semaphore.make(1)
    const lockTuning = yield* Semaphore.make(1)

    const plugs = new Map<number, PlugFacts>()

    // A successful reply without a definition means Bungie has none for the
    // hash, which reads as an empty definition. Errors fail and are not cached.
    const entity = (table: string, hash: number) =>
      platform(`/Destiny2/Manifest/${table}/${hash}/`).pipe(
        Effect.flatMap((raw) =>
          raw === undefined || raw === null
            ? Effect.succeed<PlugDefinition>({})
            : decodePlug(raw).pipe(Effect.mapError(transport)),
        ),
      )

    const perkSockets = new Map<number, ReturnType<typeof perkSocketsOf>>()

    const socketsOfWeapon = (itemHash: number) =>
      Effect.gen(function* () {
        const known = perkSockets.get(itemHash)
        if (known !== undefined) return known
        const sockets = perkSocketsOf(yield* entity("DestinyInventoryItemDefinition", itemHash))
        perkSockets.set(itemHash, sockets)
        return sockets
      })

    const weaponPerkSockets = (itemHash: number) =>
      socketsOfWeapon(itemHash).pipe(
        Effect.map((sockets) => sockets.map((socket) => socket.index)),
        Effect.catch((error) =>
          Effect.logWarning(`manifest: weapon ${itemHash} failed: ${error.message}`).pipe(
            Effect.as([]),
          ),
        ),
      )

    const perkPools = new Map<number, ReadonlyArray<PerkPool>>()

    const weaponPerkPools = (itemHash: number) =>
      Effect.gen(function* () {
        const known = perkPools.get(itemHash)
        if (known !== undefined) return known
        const sockets = yield* socketsOfWeapon(itemHash)
        const pools = yield* Effect.forEach(
          sockets,
          ({ index, plugSetHash }) =>
            plugSetHash === null
              ? Effect.succeed({ index, pool: [] })
              : platform(`/Destiny2/Manifest/DestinyPlugSetDefinition/${plugSetHash}/`).pipe(
                  Effect.flatMap((raw) =>
                    raw === undefined || raw === null
                      ? Effect.succeed<typeof PlugSetDefinition.Type>({})
                      : decodePlugSet(raw).pipe(Effect.mapError(transport)),
                  ),
                  Effect.map((definition) => ({
                    index,
                    pool: [
                      ...new Set(
                        (definition.reusablePlugItems ?? [])
                          .filter((plug) => plug.currentlyCanRoll !== false)
                          .map((plug) => plug.plugItemHash),
                      ),
                    ],
                  })),
                ),
          { concurrency: FAN_OUT },
        )
        perkPools.set(itemHash, pools)
        return pools
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`manifest: weapon ${itemHash} failed: ${error.message}`).pipe(
            Effect.as([]),
          ),
        ),
      )

    const investments = new Map<number, StatMods>()

    const plugInvestments = (hashes: ReadonlyArray<number>) =>
      Effect.forEach(
        [...new Set(hashes)].filter((hash) => !investments.has(hash)),
        (hash) =>
          entity("DestinyInventoryItemDefinition", hash).pipe(
            Effect.map((definition) => investments.set(hash, investmentOf(definition))),
            Effect.catch((error) =>
              Effect.logWarning(`manifest: plug ${hash} failed: ${error.message}`),
            ),
          ),
        { concurrency: FAN_OUT, discard: true },
      ).pipe(
        Effect.map(
          (): ReadonlyMap<number, StatMods> =>
            new Map(
              hashes.flatMap((hash) => {
                const stats = investments.get(hash)
                return stats === undefined ? [] : [[hash, stats]]
              }),
            ),
        ),
      )

    const plugSets = new Map<number, ReadonlyArray<number | null>>()

    const subclassPlugSets = (hash: number) =>
      Effect.gen(function* () {
        const known = plugSets.get(hash)
        if (known !== undefined) return known
        const definition = yield* entity("DestinyInventoryItemDefinition", hash)
        const sets = (definition.sockets?.socketEntries ?? []).map(
          (entry) => entry.reusablePlugSetHash ?? null,
        )
        plugSets.set(hash, sets)
        return sets
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`manifest: subclass ${hash} failed: ${error.message}`).pipe(
            Effect.as([]),
          ),
        ),
      )

    // Once a few hashes have failed even after retries, Bungie is down or
    // throttling hard, and the rest of the call is skipped rather than
    // waited out hash by hash. A later call asks again.
    const plugFacts = (hashes: ReadonlyArray<number>) =>
      Effect.suspend(() => {
        let failures = 0
        return Effect.forEach(
          hashes.filter((hash) => !plugs.has(hash)),
          (hash) =>
            Effect.gen(function* () {
              if (failures >= MAX_PLUG_FAILURES) return
              const definition = yield* entity("DestinyInventoryItemDefinition", hash)
              const perk = definition.perks?.[0]?.perkHash
              const own = definition.displayProperties?.description ?? ""
              const described =
                (own && !ARMOR_CHARGE.test(own)) || perk === undefined
                  ? definition
                  : yield* entity("DestinySandboxPerkDefinition", perk)
              const description = described.displayProperties?.description || own
              const known = yield* readKeywords
              plugs.set(hash, {
                mods: statModsFrom(definition, false),
                classMods: statModsFrom(definition, true),
                fragmentSlots: definition.plug?.energyCapacity?.capacityValue ?? 0,
                energyCost: definition.plug?.energyCost?.energyCost ?? 0,
                category: definition.plug?.plugCategoryIdentifier ?? "",
                artifact: (definition.plug?.insertionRules ?? []).some((rule) =>
                  /artifact/i.test(rule.failureMessage ?? ""),
                ),
                charged: ARMOR_CHARGE.test(own) || ARMOR_CHARGE.test(description),
                description,
                keywords: (definition.traitHashes ?? []).flatMap((trait) => known[trait] ?? []),
              })
            }).pipe(
              Effect.catch((error) => {
                failures += 1
                return Effect.logWarning(`manifest: plug ${hash} failed: ${error.message}`)
              }),
            ),
          { concurrency: FAN_OUT, discard: true },
        ).pipe(
          Effect.map(
            (): ReadonlyMap<number, PlugFacts> =>
              new Map(
                hashes.flatMap((hash) => {
                  const facts = plugs.get(hash)
                  return facts === undefined ? [] : [[hash, facts]]
                }),
              ),
          ),
        )
      })

    let capacities: Capacities | null = null

    const refreshCapacities = (remote: ManifestIndex) =>
      Effect.gen(function* () {
        const stored = yield* settings.get(CAPACITIES_VERSION_KEY).pipe(Effect.orDie)
        if (Option.isSome(stored) && stored.value === remote.version) return
        const path = remote.jsonWorldComponentContentPaths.en?.DestinyInventoryBucketDefinition
        if (path === undefined) return
        const buckets = yield* fetchJson(
          `https://www.bungie.net${path}`,
          definitionsOf(BucketDefinition),
        )
        capacities = capacitiesFrom(buckets)
        yield* settings.set(CAPACITIES_KEY, JSON.stringify(capacities)).pipe(Effect.orDie)
        yield* settings.set(CAPACITIES_VERSION_KEY, remote.version).pipe(Effect.orDie)
        yield* Effect.logInfo(`manifest: vault holds ${capacities.vault}`)
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`manifest: capacities failed: ${error.message}`)),
      )

    let statFacts: StatFacts | null = null

    const refreshStatFacts = (remote: ManifestIndex) =>
      Effect.gen(function* () {
        const stored = yield* settings.get(STAT_FACTS_VERSION_KEY).pipe(Effect.orDie)
        if (Option.isSome(stored) && stored.value === remote.version) return
        const path = remote.jsonWorldComponentContentPaths.en?.DestinyStatDefinition
        if (path === undefined) return
        const definitions = yield* fetchJson(
          `https://www.bungie.net${path}`,
          definitionsOf(StatDefinition),
        )
        statFacts = statFactsFrom(definitions, ARMOR_STAT_HASHES)
        yield* settings.set(STAT_FACTS_KEY, JSON.stringify(statFacts)).pipe(Effect.orDie)
        yield* settings.set(STAT_FACTS_VERSION_KEY, remote.version).pipe(Effect.orDie)
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`manifest: stat facts failed: ${error.message}`)),
      )

    let elementIcons: ElementIcons | null = null

    const refreshElementIcons = (remote: ManifestIndex) =>
      Effect.gen(function* () {
        const stored = yield* settings.get(ELEMENT_ICONS_VERSION_KEY).pipe(Effect.orDie)
        if (Option.isSome(stored) && stored.value === remote.version) return
        const path = remote.jsonWorldComponentContentPaths.en?.DestinyDamageTypeDefinition
        if (path === undefined) return
        elementIcons = elementIconsFrom(
          yield* fetchJson(`https://www.bungie.net${path}`, definitionsOf(DamageTypeDefinition)),
        )
        yield* settings.set(ELEMENT_ICONS_KEY, JSON.stringify(elementIcons)).pipe(Effect.orDie)
        yield* settings.set(ELEMENT_ICONS_VERSION_KEY, remote.version).pipe(Effect.orDie)
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`manifest: element icons failed: ${error.message}`),
        ),
      )

    let keywords: Keywords | null = null

    const refreshKeywords = (remote: ManifestIndex) =>
      Effect.gen(function* () {
        const stored = yield* settings.get(KEYWORDS_VERSION_KEY).pipe(Effect.orDie)
        if (Option.isSome(stored) && stored.value === remote.version) return
        const path = remote.jsonWorldComponentContentPaths.en?.DestinyTraitDefinition
        if (path === undefined) return
        keywords = keywordsFrom(
          yield* fetchJson(`https://www.bungie.net${path}`, definitionsOf(TraitDefinition)),
        )
        yield* settings.set(KEYWORDS_KEY, JSON.stringify(keywords)).pipe(Effect.orDie)
        yield* settings.set(KEYWORDS_VERSION_KEY, remote.version).pipe(Effect.orDie)
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`manifest: keywords failed: ${error.message}`)),
      )

    // An empty table means an earlier download stored nothing, so the saved
    // version cannot be trusted.
    const populated = sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM manifest_items
    `.pipe(
      Effect.orDie,
      Effect.map(([stored]) => (stored?.count ?? 0) > 0),
    )

    // Bungie being down should not take lookups down with it while the local
    // copy is whole; the check is tried again a few minutes later.
    const remoteIndex = manifestIndex.pipe(
      Effect.map(Option.some),
      Effect.catch((error) =>
        Effect.gen(function* () {
          const local = yield* settings.get(VERSION_KEY).pipe(Effect.orDie)
          if (Option.isNone(local) || !(yield* populated)) return yield* error
          yield* Effect.logWarning(
            `manifest: version check failed, using ${local.value}: ${error.message}`,
          )
          checkedAt = Date.now() - CHECK_EVERY_MS + RECHECK_AFTER_FAILURE_MS
          return Option.none<ManifestIndex>()
        }),
      ),
    )

    const ensure = Effect.gen(function* () {
      if (Date.now() - checkedAt < CHECK_EVERY_MS) return
      const index = yield* remoteIndex
      if (Option.isNone(index)) return
      const remote = index.value
      yield* refreshCapacities(remote)
      yield* refreshStatFacts(remote)
      yield* refreshElementIcons(remote)
      yield* refreshKeywords(remote)
      const local = yield* settings.get(VERSION_KEY).pipe(Effect.orDie)
      if ((yield* populated) && Option.isSome(local) && local.value === remote.version) {
        checkedAt = Date.now()
        return
      }
      const path = remote.jsonWorldComponentContentPaths.en?.DestinyInventoryItemLiteDefinition
      if (path === undefined) {
        return yield* new BungieError({ status: "Manifest", message: "no item definitions" })
      }
      yield* Effect.logInfo(`manifest: downloading ${remote.version}`)
      const definitions = yield* fetchJson(`https://www.bungie.net${path}`, LiteDefinitions)
      const count = yield* replaceAll(definitions).pipe(Effect.orDie)
      yield* settings.set(VERSION_KEY, remote.version).pipe(Effect.orDie)
      cache.clear()
      missing.clear()
      plugs.clear()
      plugSets.clear()
      perkPools.clear()
      perkSockets.clear()
      investments.clear()
      armorMods = null
      armorSets = null
      tuningMods = null
      checkedAt = Date.now()
      yield* Effect.logInfo(`manifest: stored ${count} items`)
    }).pipe(lock.withPermits(1))

    const lookup = (hashes: Iterable<number>) =>
      Effect.gen(function* () {
        yield* ensure
        const result = new Map<number, ManifestItem>()
        const unknown: Array<number> = []
        for (const hash of new Set(hashes)) {
          const hit = cache.get(hash)
          if (hit !== undefined) result.set(hash, hit)
          else if (!missing.has(hash)) unknown.push(hash)
        }
        for (let i = 0; i < unknown.length; i += BATCH) {
          const batch = unknown.slice(i, i + BATCH)
          const rows = yield* sql<ManifestRow>`
            SELECT * FROM manifest_items WHERE ${sql.in("hash", batch)}
          `.pipe(Effect.orDie)
          for (const row of rows) {
            const item = rowToItem(row)
            cache.set(row.hash, item)
            result.set(row.hash, item)
          }
          for (const hash of batch) if (!cache.has(hash)) missing.add(hash)
        }
        return result
      })

    const findByName = (names: ReadonlyArray<string>, kind: "described" | "any" = "described") =>
      Effect.gen(function* () {
        yield* ensure
        if (names.length === 0) return []
        const lowered = names.map((n) => n.toLowerCase())
        const described = kind === "described" ? sql`AND description IS NOT NULL` : sql``
        const rows = yield* sql<ManifestRow>`
          SELECT * FROM manifest_items WHERE lower(name) IN ${sql.in(lowered)}
          ${described} LIMIT 200
        `.pipe(Effect.orDie)
        return rows.map(rowToItem)
      })

    const readCapacities = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (capacities !== null) return capacities
      const stored = (yield* settings.get(CAPACITIES_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(StoredCapacities)),
      )
      if (Option.isNone(stored)) return FALLBACK_CAPACITIES
      capacities = { ...FALLBACK_CAPACITIES, ...stored.value }
      return capacities
    })

    const readStatFacts = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (statFacts !== null) return statFacts
      statFacts = (yield* settings.get(STAT_FACTS_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(StatFacts)),
        Option.getOrElse(() => ({})),
      )
      return statFacts
    })

    let armorMods: ReadonlyArray<ArmorModEntry> | null = null

    const readArmorMods = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (armorMods !== null) return armorMods
      const version = Option.getOrNull(yield* settings.get(VERSION_KEY).pipe(Effect.orDie))
      const storedFor = Option.getOrNull(
        yield* settings.get(ARMOR_MODS_VERSION_KEY).pipe(Effect.orDie),
      )
      const stored = (yield* settings.get(ARMOR_MODS_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(Schema.Array(ArmorModEntry))),
      )
      if (Option.isSome(stored) && storedFor === version) {
        armorMods = stored.value
        return armorMods
      }
      const rows = yield* sql<ManifestRow>`
        SELECT * FROM manifest_items
        WHERE type_name LIKE '%Armor Mod' AND type_name NOT LIKE 'Deprecated%'
          AND name NOT LIKE 'Empty %'
      `.pipe(Effect.orDie)
      const facts = yield* plugFacts(rows.map((row) => row.hash))
      // Facts are missing only where Bungie failed; storing that list would
      // hide those mods until the next patch.
      const complete = facts.size === rows.length
      const found = rows.flatMap((row): Array<ArmorModEntry> => {
        const known = facts.get(row.hash)
        if (known === undefined || !BUILD_SOCKET.test(known.category)) return []
        const item = rowToItem(row)
        return [
          {
            ...known,
            hash: row.hash,
            name: item.name,
            icon: item.icon,
            description: modDescription(item.description, known),
          },
        ]
      })
      if (found.length === 0 || !complete) return found
      armorMods = found
      yield* settings.set(ARMOR_MODS_KEY, JSON.stringify(found)).pipe(Effect.orDie)
      if (version !== null) yield* settings.set(ARMOR_MODS_VERSION_KEY, version).pipe(Effect.orDie)
      return found
    }).pipe(lockMods.withPermits(1))

    let armorSets: ReadonlyArray<ArmorSet> | null = null

    const readArmorSets = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (armorSets !== null) return armorSets
      const version = Option.getOrNull(yield* settings.get(VERSION_KEY).pipe(Effect.orDie))
      const storedFor = Option.getOrNull(
        yield* settings.get(ARMOR_SETS_VERSION_KEY).pipe(Effect.orDie),
      )
      const stored = (yield* settings.get(ARMOR_SETS_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(Schema.Array(ArmorSet))),
      )
      if (Option.isSome(stored) && storedFor === version) {
        armorSets = stored.value
        return armorSets
      }
      const index = yield* manifestIndex
      const path = index.jsonWorldComponentContentPaths.en?.DestinyEquipableItemSetDefinition
      if (path === undefined) return []
      const definitions = yield* fetchJson(
        `https://www.bungie.net${path}`,
        definitionsOf(EquipableItemSetDefinition),
      )
      const perkHashes = new Set(
        Object.values(definitions).flatMap((definition) =>
          (definition.setPerks ?? []).flatMap((perk) =>
            perk.sandboxPerkHash === undefined ? [] : [perk.sandboxPerkHash],
          ),
        ),
      )
      const perks = new Map<number, PlugDefinition>()
      yield* Effect.forEach(
        perkHashes,
        (hash) =>
          entity("DestinySandboxPerkDefinition", hash).pipe(
            Effect.map((definition) => perks.set(hash, definition)),
            Effect.catch((error) =>
              Effect.logWarning(`manifest: set perk ${hash} failed: ${error.message}`),
            ),
          ),
        { concurrency: FAN_OUT, discard: true },
      )
      const found = armorSetsFrom(definitions, perks)
      if (found.length === 0 || perks.size < perkHashes.size) return found
      armorSets = found
      yield* settings.set(ARMOR_SETS_KEY, JSON.stringify(found)).pipe(Effect.orDie)
      if (version !== null) yield* settings.set(ARMOR_SETS_VERSION_KEY, version).pipe(Effect.orDie)
      yield* Effect.logInfo(`manifest: resolved ${found.length} armor sets`)
      return found
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`manifest: armor sets failed: ${error.message}`).pipe(Effect.as([])),
      ),
      lockSets.withPermits(1),
    )

    let tuningMods: TuningMods | null = null

    const readTuningMods = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (tuningMods !== null) return tuningMods
      const version = Option.getOrNull(yield* settings.get(VERSION_KEY).pipe(Effect.orDie))
      const storedFor = Option.getOrNull(
        yield* settings.get(TUNING_MODS_VERSION_KEY).pipe(Effect.orDie),
      )
      const stored = (yield* settings.get(TUNING_MODS_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(StoredTuningMods)),
      )
      if (Option.isSome(stored) && storedFor === version) {
        tuningMods = new Map(stored.value)
        return tuningMods
      }
      const rows = yield* sql<ManifestRow>`
        SELECT * FROM manifest_items WHERE type_name = 'General Armor Mod'
      `.pipe(Effect.orDie)
      const facts = yield* plugFacts(rows.map((row) => row.hash))
      // A partial list could leave a legendary's tuned stat out and read it as
      // balanced, so tuning stays unread until every mod is known.
      if (facts.size < rows.length) return new Map()
      const found = tuningModsFrom(facts)
      tuningMods = found
      yield* settings.set(TUNING_MODS_KEY, JSON.stringify([...found])).pipe(Effect.orDie)
      if (version !== null) yield* settings.set(TUNING_MODS_VERSION_KEY, version).pipe(Effect.orDie)
      return found
    }).pipe(lockTuning.withPermits(1))

    const readKeywords = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (keywords !== null) return keywords
      keywords = (yield* settings.get(KEYWORDS_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(Keywords)),
        Option.getOrElse(() => ({})),
      )
      return keywords
    })

    const readElementIcons = Effect.gen(function* () {
      yield* Effect.ignore(ensure)
      if (elementIcons !== null) return elementIcons
      elementIcons = (yield* settings.get(ELEMENT_ICONS_KEY).pipe(Effect.orDie)).pipe(
        Option.flatMap(storedJson(StoredElementIcons)),
        Option.getOrElse(() => ({})),
      )
      return elementIcons
    })

    return {
      armorMods: readArmorMods,
      armorSets: readArmorSets,
      tuningMods: readTuningMods,
      elementIcons: readElementIcons,
      capacities: readCapacities,
      statFacts: readStatFacts,
      plugFacts,
      subclassPlugSets,
      weaponPerkPools,
      weaponPerkSockets,
      plugInvestments,
      ensure,
      lookup,
      findByName,
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
