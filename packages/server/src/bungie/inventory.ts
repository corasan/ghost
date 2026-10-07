import {
  type AbilityKind,
  CharacterStats,
  type DamageType,
  type GuardianClass,
  type ItemDecision,
  type ItemLocation,
  type ItemSlot,
  ItemPerk,
  type ItemSummary,
} from "@ghost/contract"
import { Schema } from "effect"
import {
  type ArmorSet,
  BUCKETS,
  damageForType,
  type ManifestItem,
  slotForBucket,
  type TuningMods,
} from "./manifest.ts"

// Turns one GetProfile response into the flat list of owned items and the
// per-character facts every screen and tool reads. Pure on purpose: the
// profile, the item definitions and what Ghost remembers about each instance
// all come in as arguments, so tests can hand it a fixture.

const RawItem = Schema.Struct({
  itemHash: Schema.Number,
  itemInstanceId: Schema.optional(Schema.String),
  quantity: Schema.Number,
  bucketHash: Schema.Number,
  /** ItemState bitmask: 1 locked, 4 masterwork, 8 crafted. */
  state: Schema.optional(Schema.Number),
})
export type RawItem = typeof RawItem.Type

const Instance = Schema.Struct({
  damageType: Schema.optional(Schema.Number),
  primaryStat: Schema.optional(Schema.Struct({ value: Schema.Number })),
  gearTier: Schema.optional(Schema.Number),
  energy: Schema.optional(
    Schema.Struct({
      energyCapacity: Schema.optional(Schema.Number),
      energyUsed: Schema.optional(Schema.Number),
    }),
  ),
})

const ItemStats = Schema.Struct({
  stats: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ value: Schema.Number }))),
})

const ItemSockets = Schema.Struct({
  sockets: Schema.Array(
    Schema.Struct({
      plugHash: Schema.optional(Schema.Number),
      isEnabled: Schema.optional(Schema.Boolean),
      isVisible: Schema.optional(Schema.Boolean),
    }),
  ),
})

const ReusablePlugs = Schema.Struct({
  plugs: Schema.Record(Schema.String, Schema.Array(Schema.Struct({ plugItemHash: Schema.Number }))),
})

const Character = Schema.Struct({
  characterId: Schema.String,
  classType: Schema.Number,
  light: Schema.Number,
  stats: Schema.Record(Schema.String, Schema.Number),
})

const ItemList = Schema.Struct({ items: Schema.Array(RawItem) })

const component = <S extends Schema.Top>(data: S) =>
  Schema.optional(Schema.Struct({ data: Schema.optional(data) }))

const byInstance = <S extends Schema.Top>(value: S) =>
  Schema.optional(Schema.Struct({ data: Schema.optional(Schema.Record(Schema.String, value)) }))

// Components: 100 profile, 102 vault, 200 characters, 201 character
// inventories (incl. postmaster), 205 equipment, 300 instances (power,
// element), 304 item stats (armor totals), 305 sockets (weapon perks) and
// the profile and character plug sets, 310 reusable plugs (the tuning mods a
// piece of armor accepts, which name its tuned stat).
export const PROFILE_COMPONENTS = [100, 102, 200, 201, 205, 300, 304, 305, 310]

export const Profile = Schema.Struct({
  profile: component(
    Schema.Struct({
      userInfo: Schema.Struct({ membershipType: Schema.Number, membershipId: Schema.String }),
    }),
  ),
  profileInventory: component(ItemList),
  characters: component(Schema.Record(Schema.String, Character)),
  characterInventories: component(Schema.Record(Schema.String, ItemList)),
  characterEquipment: component(Schema.Record(Schema.String, ItemList)),
  itemComponents: Schema.optional(
    Schema.Struct({
      instances: byInstance(Instance),
      stats: byInstance(ItemStats),
      sockets: byInstance(ItemSockets),
      reusablePlugs: byInstance(ReusablePlugs),
    }),
  ),
})
export type Profile = typeof Profile.Type

export const STAT = {
  mobility: "2996146975",
  resilience: "392767087",
  recovery: "1943323491",
  discipline: "1735777505",
  intellect: "144602215",
  strength: "4244567218",
} as const

export type ArmorStats = typeof CharacterStats.Type

/**
 * Which stat a piece's tuning mods raise. Tier 5 legendary armor rolls one
 * stat at random; tier 5 exotics take any stat; lower tiers only take
 * Balanced Tuning.
 */
export type Tuning = keyof ArmorStats | "any" | "balanced"

/** Everything the contract's ItemSummary has, plus the six armor stats. */
export type OwnedItem = Schema.Struct.Type<typeof ItemSummary.fields> & {
  readonly itemInstanceId: string
  readonly armorStats: ArmorStats | null
  /** Every plug in the weapon's sockets, in order; what wishlist rolls are matched against. */
  readonly plugHashes: ReadonlyArray<number>
  /** Armor only: its mod sockets in socket order. */
  readonly modSockets: ReadonlyArray<ModSocket>
  readonly energy: { readonly used: number; readonly capacity: number } | null
  /** Exotic armor only: its intrinsic perk. */
  readonly exoticPerk: ItemPerk | null
  /** Exotic armor only: every intrinsic perk, which on an exotic class item includes its two rolled perks. */
  readonly intrinsics: ReadonlyArray<string>
  /** Armor only: the armor set it belongs to. */
  readonly set: ArmorSet | null
  readonly crafted: boolean
  /** Armor only: null when the piece has no tuning socket, or its tuning mods could not be read. */
  readonly tuning: Tuning | null
  /** Weapons only: each trait column's perks, every option the column can slot, not just the selected one. */
  readonly traits: ReadonlyArray<ReadonlyArray<string>>
}

export interface ModSocket {
  /** Position among the item's sockets, which is how Bungie addresses it. */
  readonly index: number
  readonly plugHash: number
  readonly empty: boolean
}

export interface SubclassPlug {
  readonly hash: number
  readonly name: string
  readonly description: string
  readonly icon: string | null
}

export interface SlottedPlugs {
  readonly super: SubclassPlug | null
  readonly abilities: ReadonlyArray<SubclassPlug & { readonly kind: AbilityKind }>
  readonly aspects: ReadonlyArray<SubclassPlug>
  readonly fragments: ReadonlyArray<SubclassPlug>
}

const ARMOR_MOD = /\barmor mod$/i
const EMPTY_SOCKET = /^empty /i

export type SubclassPart = "super" | AbilityKind | "aspect" | "fragment"

const PART_TYPES: ReadonlyArray<readonly [SubclassPart, RegExp]> = [
  ["super", /\bsuper\b/i],
  ["class", /\bclass ability\b/i],
  ["jump", /\bmovement\b/i],
  ["melee", /\bmelee\b/i],
  ["grenade", /\bgrenade\b/i],
  ["aspect", /\baspect\b/i],
  ["fragment", /\bfragment\b/i],
]

export const ABILITY_KINDS: ReadonlyArray<AbilityKind> = ["class", "jump", "melee", "grenade"]

/** Which part of a subclass a plug fills, read from its type name, such as "Void Fragment". */
export const subclassPart = (typeName: string): SubclassPart | null =>
  PART_TYPES.find(([, type]) => type.test(typeName))?.[0] ?? null

export const isEmptyPlug = (name: string) => EMPTY_SOCKET.test(name)

const toPlug = ({ hash, name, description, icon }: ManifestItem): SubclassPlug => ({
  hash,
  name,
  description,
  icon,
})

/** Sorts a subclass's slotted plugs into super, abilities, aspects and fragments; empty sockets are dropped. */
export const slottedPlugs = (
  plugHashes: ReadonlyArray<number>,
  defs: ReadonlyMap<number, ManifestItem>,
): SlottedPlugs => {
  const plugs = plugHashes.flatMap((hash) => {
    const def = defs.get(hash)
    return def === undefined || EMPTY_SOCKET.test(def.name) ? [] : [def]
  })
  const of = (part: SubclassPart) =>
    plugs.filter((plug) => subclassPart(plug.typeName) === part).map(toPlug)
  return {
    super: of("super")[0] ?? null,
    abilities: ABILITY_KINDS.flatMap((kind) => {
      const plug = of(kind)[0]
      return plug === undefined ? [] : [{ ...plug, kind }]
    }),
    aspects: of("aspect"),
    fragments: of("fragment"),
  }
}

export interface OwnedSubclass {
  readonly itemInstanceId: string
  readonly itemHash: number
  readonly name: string
  readonly icon: string | null
  readonly element: DamageType
  readonly equipped: boolean
  readonly sockets: ReadonlyArray<{ readonly plugHash: number; readonly enabled: boolean }>
}

export interface CharacterInfo {
  readonly characterId: string
  readonly classType: GuardianClass
  readonly light: number
  readonly subclass: string | null
  readonly subclassIcon: string | null
  readonly ghostIcon: string | null
  readonly element: DamageType
  readonly loadout: SlottedPlugs
  readonly subclasses: ReadonlyArray<OwnedSubclass>
  readonly stats: CharacterStats
  /** Everything in the postmaster, stackables included, since all of it counts toward 21. */
  readonly postmasterCount: number
}

export interface Inventory {
  readonly membershipType: number
  readonly membershipId: string
  /** Highest light first. */
  readonly characters: ReadonlyArray<CharacterInfo>
  /** Instanced items only; materials and consumables are not things Ghost moves. */
  readonly items: ReadonlyArray<OwnedItem>
  /** Every vault entry, stacks included, since that is what fills the vault. */
  readonly vaultCount: number
}

export interface SeenInfo {
  readonly decision: ItemDecision | null
  readonly firstSeenAt: string
  readonly baseline: boolean
}

const STAT_KEYS = new Map<string, keyof ArmorStats>([
  [STAT.mobility, "mobility"],
  [STAT.resilience, "resilience"],
  [STAT.recovery, "recovery"],
  [STAT.discipline, "discipline"],
  [STAT.intellect, "intellect"],
  [STAT.strength, "strength"],
])

/** The tuning a piece accepts, read from the reusable plugs of its tuning socket. */
export const tuningOf = (
  sockets: ReadonlyArray<ReadonlyArray<number>>,
  mods: TuningMods,
): Tuning | null => {
  const offered = sockets.find((plugs) => plugs.some((hash) => mods.has(hash)))
  if (offered === undefined) return null
  const raised = new Set(
    offered.flatMap((hash) => {
      const key = STAT_KEYS.get(mods.get(hash) ?? "")
      return key === undefined ? [] : [key]
    }),
  )
  const [only] = raised
  if (raised.size > 1) return "any"
  return only ?? "balanced"
}

export const classFor = (classType: number): GuardianClass =>
  classType === 0 ? "titan" : classType === 1 ? "hunter" : "warlock"

const ARMOR_SLOTS: ReadonlySet<ItemSlot> = new Set(["helmet", "arms", "chest", "legs", "class"])
const WEAPON_SLOTS: ReadonlySet<ItemSlot> = new Set(["kinetic", "energy", "power"])
export const isArmor = (slot: ItemSlot) => ARMOR_SLOTS.has(slot)
export const isWeapon = (slot: ItemSlot) => WEAPON_SLOTS.has(slot)

// Older subclass definitions carry no damage type; their names do.
const SUBCLASS_ELEMENTS = new Map<string, DamageType>([
  ["Arcstrider", "arc"],
  ["Striker", "arc"],
  ["Stormcaller", "arc"],
  ["Gunslinger", "solar"],
  ["Sunbreaker", "solar"],
  ["Dawnblade", "solar"],
  ["Nightstalker", "void"],
  ["Sentinel", "void"],
  ["Voidwalker", "void"],
  ["Revenant", "stasis"],
  ["Behemoth", "stasis"],
  ["Shadebinder", "stasis"],
  ["Threadrunner", "strand"],
  ["Berserker", "strand"],
  ["Broodweaver", "strand"],
])

const elementOf = (subclass: ManifestItem): DamageType =>
  subclass.damageType !== "none"
    ? subclass.damageType
    : (SUBCLASS_ELEMENTS.get(subclass.name) ?? "none")

const statsFrom = (stats: Readonly<Record<string, number>>) =>
  new CharacterStats({
    mobility: stats[STAT.mobility] ?? 0,
    resilience: stats[STAT.resilience] ?? 0,
    recovery: stats[STAT.recovery] ?? 0,
    discipline: stats[STAT.discipline] ?? 0,
    intellect: stats[STAT.intellect] ?? 0,
    strength: stats[STAT.strength] ?? 0,
  })

/** Every hash the profile mentions, plugs included, so one manifest lookup covers it. */
const isTrait = (plug: ManifestItem) => plug.typeName.includes("Trait")

export const profileHashes = (profile: Profile): Set<number> => {
  const hashes = new Set<number>()
  const add = (list: { readonly items: ReadonlyArray<RawItem> } | undefined) => {
    for (const item of list?.items ?? []) hashes.add(item.itemHash)
  }
  add(profile.profileInventory?.data)
  for (const list of Object.values(profile.characterInventories?.data ?? {})) add(list)
  for (const list of Object.values(profile.characterEquipment?.data ?? {})) add(list)
  for (const entry of Object.values(profile.itemComponents?.sockets?.data ?? {})) {
    for (const socket of entry.sockets)
      if (socket.plugHash !== undefined) hashes.add(socket.plugHash)
  }
  for (const entry of Object.values(profile.itemComponents?.reusablePlugs?.data ?? {})) {
    for (const plugs of Object.values(entry.plugs))
      for (const plug of plugs) hashes.add(plug.plugItemHash)
  }
  return hashes
}

interface Placed {
  readonly raw: RawItem & { readonly itemInstanceId: string }
  readonly location: ItemLocation
  readonly characterId: string | null
  readonly equipped: boolean
}

export const buildInventory = (
  profile: Profile,
  defs: ReadonlyMap<number, ManifestItem>,
  seen: ReadonlyMap<string, SeenInfo>,
  sets: ReadonlyMap<number, ArmorSet>,
  tuningMods: TuningMods,
): Inventory => {
  const reusable = profile.itemComponents?.reusablePlugs?.data ?? {}
  const instances = profile.itemComponents?.instances?.data ?? {}
  const itemStats = profile.itemComponents?.stats?.data ?? {}
  const sockets = profile.itemComponents?.sockets?.data ?? {}
  const vault = (profile.profileInventory?.data?.items ?? []).filter(
    (i) => i.bucketHash === BUCKETS.vault,
  )

  const placed: Array<Placed> = []
  const place = (
    raw: RawItem,
    location: ItemLocation,
    characterId: string | null,
    equipped: boolean,
  ) => {
    const id = raw.itemInstanceId
    if (id === undefined || raw.bucketHash === BUCKETS.subclass) return
    placed.push({ raw: { ...raw, itemInstanceId: id }, location, characterId, equipped })
  }
  for (const raw of vault) place(raw, "vault", null, false)

  const characters: Array<CharacterInfo> = []
  for (const c of Object.values(profile.characters?.data ?? {})) {
    const inventory = profile.characterInventories?.data?.[c.characterId]?.items ?? []
    const equipment = profile.characterEquipment?.data?.[c.characterId]?.items ?? []
    for (const raw of inventory) {
      place(
        raw,
        raw.bucketHash === BUCKETS.postmaster ? "postmaster" : "character",
        c.characterId,
        false,
      )
    }
    for (const raw of equipment) place(raw, "character", c.characterId, true)
    const subclassItem = equipment.find((i) => i.bucketHash === BUCKETS.subclass)
    const subclass = subclassItem === undefined ? undefined : defs.get(subclassItem.itemHash)
    const subclasses = [...equipment, ...inventory].flatMap((raw): Array<OwnedSubclass> => {
      const def = defs.get(raw.itemHash)
      if (raw.bucketHash !== BUCKETS.subclass || raw.itemInstanceId === undefined || !def) return []
      return [
        {
          itemInstanceId: raw.itemInstanceId,
          itemHash: raw.itemHash,
          name: def.name,
          icon: def.icon,
          element: elementOf(def),
          equipped: raw === subclassItem,
          sockets: (sockets[raw.itemInstanceId]?.sockets ?? []).map((socket) => ({
            plugHash: socket.plugHash ?? 0,
            enabled: socket.isEnabled !== false,
          })),
        },
      ]
    })
    characters.push({
      characterId: c.characterId,
      classType: classFor(c.classType),
      light: c.light,
      subclass: subclass?.name ?? null,
      subclassIcon: subclass?.icon ?? null,
      ghostIcon:
        defs.get(equipment.find((i) => i.bucketHash === BUCKETS.ghost)?.itemHash ?? 0)?.icon ??
        null,
      element: subclass === undefined ? "none" : elementOf(subclass),
      loadout: slottedPlugs(
        (sockets[subclassItem?.itemInstanceId ?? ""]?.sockets ?? []).flatMap((socket) =>
          socket.plugHash === undefined ? [] : [socket.plugHash],
        ),
        defs,
      ),
      subclasses,
      stats: statsFrom(c.stats),
      postmasterCount: inventory.filter((i) => i.bucketHash === BUCKETS.postmaster).length,
    })
  }
  characters.sort((a, b) => b.light - a.light)

  const copies = new Map<number, number>()
  for (const p of placed) copies.set(p.raw.itemHash, (copies.get(p.raw.itemHash) ?? 0) + 1)

  const items = placed.map(({ raw, location, characterId, equipped }): OwnedItem => {
    const def = defs.get(raw.itemHash)
    const id = raw.itemInstanceId
    const instance = instances[id]
    // Vault and postmaster items sit in a shared bucket, so the slot comes
    // from the definition; character items carry their real bucket.
    const bucket =
      raw.bucketHash === BUCKETS.vault || raw.bucketHash === BUCKETS.postmaster
        ? (def?.bucketHash ?? 0)
        : raw.bucketHash
    const slot = slotForBucket(bucket)
    const armor = isArmor(slot)
    const rawStats = itemStats[id]?.stats
    const armorStats =
      armor && rawStats !== undefined
        ? statsFrom(Object.fromEntries(Object.entries(rawStats).map(([k, v]) => [k, v.value])))
        : null
    const plugHashes = isWeapon(slot)
      ? (sockets[id]?.sockets ?? []).flatMap((socket) =>
          socket.plugHash === undefined || socket.isEnabled === false || socket.isVisible === false
            ? []
            : [socket.plugHash],
        )
      : []
    const modSockets = armor
      ? (sockets[id]?.sockets ?? []).flatMap((socket, index): Array<ModSocket> => {
          const plug = socket.plugHash === undefined ? undefined : defs.get(socket.plugHash)
          if (plug === undefined || socket.isVisible === false || !ARMOR_MOD.test(plug.typeName))
            return []
          return [{ index, plugHash: plug.hash, empty: EMPTY_SOCKET.test(plug.name) }]
        })
      : []
    const intrinsics =
      armor && def?.tier === "exotic"
        ? (sockets[id]?.sockets ?? []).flatMap((socket) => {
            const plug = socket.plugHash === undefined ? undefined : defs.get(socket.plugHash)
            return plug?.typeName === "Intrinsic" && plug.description !== "" ? [plug] : []
          })
        : []
    const intrinsic = intrinsics[0]
    const perks = plugHashes.flatMap((hash) => {
      const plug = defs.get(hash)
      return plug !== undefined && isTrait(plug) ? [plug.name] : []
    })
    const traits = isWeapon(slot)
      ? (sockets[id]?.sockets ?? []).flatMap((socket, index) => {
          const selected = socket.plugHash === undefined ? undefined : defs.get(socket.plugHash)
          if (selected === undefined || !isTrait(selected) || socket.isVisible === false) return []
          const options = (reusable[id]?.plugs[String(index)] ?? []).flatMap((plug) => {
            const option = defs.get(plug.plugItemHash)
            return option !== undefined && isTrait(option) ? [option.name] : []
          })
          return [[...new Set([selected.name, ...options])]]
        })
      : []
    const state = raw.state ?? 0
    const memory = seen.get(id)
    return {
      itemInstanceId: id,
      itemHash: raw.itemHash,
      name: def?.name ?? `#${raw.itemHash}`,
      typeName: def?.typeName ?? "",
      icon: def?.icon ?? null,
      tier: def?.tier ?? "unknown",
      slot,
      damageType:
        instance?.damageType !== undefined
          ? damageForType(instance.damageType)
          : (def?.damageType ?? "none"),
      power: instance?.primaryStat?.value ?? null,
      quantity: raw.quantity,
      location,
      characterId,
      equipped,
      classType: armor && def !== undefined && def.classType < 3 ? classFor(def.classType) : null,
      locked: (state & 1) !== 0,
      masterwork: (state & 4) !== 0,
      gearTier: instance?.gearTier || null,
      statTotal:
        armorStats === null
          ? null
          : armorStats.mobility +
            armorStats.resilience +
            armorStats.recovery +
            armorStats.discipline +
            armorStats.intellect +
            armorStats.strength,
      perks,
      duplicates: (copies.get(raw.itemHash) ?? 1) - 1,
      decision: memory?.decision ?? null,
      acquiredAt: memory === undefined || memory.baseline ? null : memory.firstSeenAt,
      armorStats,
      plugHashes,
      modSockets,
      energy:
        armor && instance?.energy?.energyCapacity !== undefined
          ? { used: instance.energy.energyUsed ?? 0, capacity: instance.energy.energyCapacity }
          : null,
      exoticPerk:
        intrinsic === undefined
          ? null
          : new ItemPerk({
              name: intrinsic.name,
              description: intrinsic.description,
              icon: intrinsic.icon,
              trait: false,
            }),
      intrinsics: intrinsics.map((plug) => plug.name),
      set: armor ? (sets.get(raw.itemHash) ?? null) : null,
      crafted: (state & 8) !== 0,
      tuning: armor
        ? tuningOf(
            Object.values(reusable[id]?.plugs ?? {}).map((plugs) =>
              plugs.map((plug) => plug.plugItemHash),
            ),
            tuningMods,
          )
        : null,
      traits,
    }
  })

  const userInfo = profile.profile?.data?.userInfo
  return {
    membershipType: userInfo?.membershipType ?? 0,
    membershipId: userInfo?.membershipId ?? "",
    characters,
    items,
    vaultCount: vault.length,
  }
}

/** The selected character, or the highest-light one when none (or an unknown one) is given. */
export const pickCharacter = (
  inventory: Inventory,
  characterId?: string | null,
): CharacterInfo | undefined =>
  inventory.characters.find((c) => c.characterId === characterId) ?? inventory.characters[0]

// An upgrade has to beat what the character wears in that slot today, so a
// slot with nothing equipped (or a class that cannot use the item) never
// counts. Weapons compare power. Armor compares stat totals with a margin of
// 2, since a point or two is noise. Only one exotic armor piece can be worn,
// so an exotic only counts when it would replace the exotic already on.
export const isUpgrade = (
  item: OwnedItem,
  character: CharacterInfo,
  items: ReadonlyArray<OwnedItem>,
): boolean => {
  if (item.equipped && item.characterId === character.characterId) return false
  if (!isWeapon(item.slot) && !isArmor(item.slot)) return false
  if (item.classType !== null && item.classType !== character.classType) return false
  const current = items.find(
    (i) => i.equipped && i.characterId === character.characterId && i.slot === item.slot,
  )
  if (current === undefined) return false
  if (isWeapon(item.slot)) {
    return item.power !== null && current.power !== null && item.power > current.power
  }
  if (item.tier === "exotic" && current.tier !== "exotic") return false
  return (
    item.statTotal !== null && current.statTotal !== null && item.statTotal > current.statTotal + 2
  )
}
