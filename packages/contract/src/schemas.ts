import { Schema } from "effect"

// Shared wire types. Both the server (to validate and encode) and the app
// (to decode) derive their TypeScript types from these, so a field rename
// here is a compile error on both sides instead of a runtime surprise.

// ---- Item vocabulary ----

export const ItemLocation = Schema.Literals(["postmaster", "character", "vault"])
export type ItemLocation = typeof ItemLocation.Type

export const ItemTier = Schema.Literals(["exotic", "legendary", "rare", "common", "unknown"])
export type ItemTier = typeof ItemTier.Type

export const DamageType = Schema.Literals([
  "kinetic",
  "arc",
  "solar",
  "void",
  "stasis",
  "strand",
  "none",
])
export type DamageType = typeof DamageType.Type

export const ItemSlot = Schema.Literals([
  "kinetic",
  "energy",
  "power",
  "helmet",
  "arms",
  "chest",
  "legs",
  "class",
  "other",
])
export type ItemSlot = typeof ItemSlot.Type

export const WeaponSlot = Schema.Literals(["kinetic", "energy", "power"])
export type WeaponSlot = typeof WeaponSlot.Type

export const GuardianClass = Schema.Literals(["titan", "hunter", "warlock"])
export type GuardianClass = typeof GuardianClass.Type

export const ItemDecision = Schema.Literals(["keep", "junk"])
export type ItemDecision = typeof ItemDecision.Type

/**
 * One owned item, wherever it lives. Everything the app filters on is a
 * field here, so the vault screen can slice 600 items locally without
 * asking the server again.
 */
/** A mod slotted in a piece of armor, as the inventory shows it. */
export class SlottedMod extends Schema.Class<SlottedMod>("SlottedMod")({
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
}) {}

export class ItemSummary extends Schema.Class<ItemSummary>("ItemSummary")({
  itemInstanceId: Schema.NullOr(Schema.String),
  itemHash: Schema.Number,
  name: Schema.String,
  typeName: Schema.String,
  /** Absolute bungie.net URL of the item's icon, when the manifest has one. */
  icon: Schema.NullOr(Schema.String),
  tier: ItemTier,
  slot: ItemSlot,
  damageType: DamageType,
  power: Schema.NullOr(Schema.Number),
  quantity: Schema.Number,
  location: ItemLocation,
  /** Owning character for character and postmaster items, null in the vault. */
  characterId: Schema.NullOr(Schema.String),
  equipped: Schema.Boolean,
  /** Armor that only one class can wear; null for weapons and class-agnostic items. */
  classType: Schema.NullOr(GuardianClass),
  locked: Schema.Boolean,
  masterwork: Schema.Boolean,
  /** The gear tier, 1 to 5, on items that have one. */
  gearTier: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Sum of the six armor stats, null for weapons. */
  statTotal: Schema.NullOr(Schema.Number),
  /** Weapon trait names (the perks that make a roll), in socket order. */
  perks: Schema.Array(Schema.String),
  /** How many other copies of the same item the player owns. */
  duplicates: Schema.Number,
  decision: Schema.NullOr(ItemDecision),
  /** Armor only, in socket order; null for an empty socket. Sent only with the guardian snapshot. */
  mods: Schema.optional(Schema.Array(Schema.NullOr(SlottedMod))),
  /** When Ghost first saw this instance; null for items from the first sync. */
  acquiredAt: Schema.NullOr(Schema.String),
}) {}

// ---- Plans: what Ghost proposes, the player confirms ----

/**
 * What confirming a row does. The server executes these itself after the
 * player confirms, so the agent never moves an item on its own.
 */
export const PlanAction = Schema.Literals([
  "to_vault",
  "to_character",
  "pull_postmaster",
  "equip",
  "tag_junk",
  "none",
])
export type PlanAction = typeof PlanAction.Type

export const RowOutcome = Schema.Literals(["ok", "failed", "skipped"])
export type RowOutcome = typeof RowOutcome.Type

export class PlanStat extends Schema.Class<PlanStat>("PlanStat")({
  /** Short label, for example "RES". */
  label: Schema.String,
  value: Schema.Number,
  /** True when this stat is one the player asked for. */
  target: Schema.Boolean,
  /** The value once the armor behind it is masterworked, when that is higher. */
  masterworked: Schema.optional(Schema.Number),
  /** In a build, what the stat does, in Bungie's words for the current patch. */
  effect: Schema.optional(Schema.String),
}) {}

/** How far one plug (a fragment or an armor mod) moves one stat. */
export class StatMod extends Schema.Class<StatMod>("StatMod")({
  /** The stat's label as it appears in the plan's stats. */
  label: Schema.String,
  delta: Schema.Number,
}) {}

/**
 * Where a judgement came from. Ghost must ground roll, build and mod advice
 * in data it fetched for this answer (the current manifest, community
 * wishlists, recent articles), never in model memory, and show it.
 */
export class Source extends Schema.Class<Source>("Source")({
  /** For example "DIM wishlist (voltron)" or "Bungie manifest". */
  label: Schema.String,
  url: Schema.NullOr(Schema.String),
  /** When the data was published or fetched, ISO; shown as "2 DAYS OLD". */
  asOf: Schema.NullOr(Schema.String),
}) {}

/** What a mod adds while its wearer holds Armor Charge, in numbers Ghost looked up. */
export class ChargeEffect extends Schema.Class<ChargeEffect>("ChargeEffect")({
  /** For example "+10% Arc weapon damage; 17% with two copies, 22% with three". */
  effect: Schema.String,
  source: Source,
}) {}

/** One mod slotted in an armor piece, read from the game. */
export class ArmorMod extends Schema.Class<ArmorMod>("ArmorMod")({
  name: Schema.String,
  icon: Schema.optional(Schema.NullOr(Schema.String)),
  /** Effect text from the current patch's manifest. */
  description: Schema.String,
  /** Armor energy the mod takes. */
  cost: Schema.Number,
  /** Stat changes it brings, counted in the plan's stats. */
  mods: Schema.Array(StatMod),
  /** Its effect depends on the wearer holding Armor Charge. */
  charged: Schema.optional(Schema.Boolean),
  chargeEffect: Schema.optional(ChargeEffect),
  /** True when the plan puts this mod in; the rest are already slotted. */
  swap: Schema.optional(Schema.Boolean),
  /** The mod this one takes the place of, when the socket was not free. */
  replaces: Schema.optional(Schema.NullOr(Schema.String)),
  /** What the server needs to insert a swap and to undo it. */
  socketIndex: Schema.optional(Schema.Number),
  plugHash: Schema.optional(Schema.Number),
  previousPlugHash: Schema.optional(Schema.Number),
}) {}

export class PlanPerk extends Schema.Class<PlanPerk>("PlanPerk")({
  name: Schema.String,
  /** Highlighted as part of what makes the roll good. */
  good: Schema.Boolean,
}) {}

export class PlanRow extends Schema.Class<PlanRow>("PlanRow")({
  itemInstanceId: Schema.String,
  itemHash: Schema.Number,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
  tier: ItemTier,
  /** One short line under the name, for example "CHEST · REPLACES IRON FORERUNNER". */
  meta: Schema.String,
  power: Schema.NullOr(Schema.Number),
  /** A 0-100 roll score when Ghost ranked the item. */
  score: Schema.NullOr(Schema.Number),
  action: PlanAction,
  /** Target character for to_character and equip; the owner for pulls. */
  characterId: Schema.NullOr(Schema.String),
  /** Ghost's default. The player can untick it before confirming. A row's mod swaps run only when it is ticked. */
  selected: Schema.Boolean,
  outcome: Schema.NullOr(RowOutcome),
  error: Schema.NullOr(Schema.String),
  /** The six stats of an armor piece; left out for weapons. */
  stats: Schema.optional(Schema.Array(PlanStat)),
  slot: Schema.optional(ItemSlot),
  masterwork: Schema.optional(Schema.Boolean),
  damageType: Schema.optional(DamageType),
  gearTier: Schema.optional(Schema.NullOr(Schema.Number)),
  /** The mods slotted in an armor piece; left out for weapons and older plans. */
  armorMods: Schema.optional(Schema.Array(ArmorMod)),
  freeModSlots: Schema.optional(Schema.Number),
  energy: Schema.optional(Schema.Struct({ used: Schema.Number, capacity: Schema.Number })),
  /** Where a piece comes from when it is not already on the character, for example "VAULT" or "HUNTER". */
  origin: Schema.optional(Schema.String),
  /** A weapon's trait perks; `good` when the wishlist roll calls for them. Weapon rows only. */
  perks: Schema.optional(Schema.Array(PlanPerk)),
  /** A weapon's type, for example "Combat Bow". Weapon rows only. */
  typeName: Schema.optional(Schema.String),
}) {}

/** The winner of a "best weapon" answer, shown large above the runners-up. */
export class PlanFeatured extends Schema.Class<PlanFeatured>("PlanFeatured")({
  itemInstanceId: Schema.String,
  perks: Schema.Array(PlanPerk),
  stats: Schema.Array(PlanStat),
}) {}

/** A game term such as Weaken or Volatile, as the game defines it in tooltips. */
export class Keyword extends Schema.Class<Keyword>("Keyword")({
  name: Schema.String,
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
}) {}

export class LoadoutPlug extends Schema.Class<LoadoutPlug>("LoadoutPlug")({
  name: Schema.String,
  /** Effect text from the current patch's manifest. */
  description: Schema.String,
  icon: Schema.optional(Schema.NullOr(Schema.String)),
  mods: Schema.Array(StatMod),
  /** How many fragment slots an aspect brings. */
  fragmentSlots: Schema.optional(Schema.Number),
  /** True when the plan puts this plug in; the rest are already slotted. */
  swap: Schema.optional(Schema.Boolean),
  /** The plug this one takes the place of, when the socket was not empty. */
  replaces: Schema.optional(Schema.NullOr(Schema.String)),
  /** The keywords its effect text uses. */
  keywords: Schema.optional(Schema.Array(Keyword)),
}) {}

export const AbilityKind = Schema.Literals(["class", "jump", "melee", "grenade"])
export type AbilityKind = typeof AbilityKind.Type

export class LoadoutAbility extends Schema.Class<LoadoutAbility>("LoadoutAbility")({
  kind: AbilityKind,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
  /** True when the plan puts this ability in. */
  swap: Schema.optional(Schema.Boolean),
}) {}

/** A subclass plug the plan puts in, with what the server needs to insert it and to undo it. */
export class SubclassSwap extends Schema.Class<SubclassSwap>("SubclassSwap")({
  name: Schema.String,
  socketIndex: Schema.Number,
  plugHash: Schema.Number,
  previousPlugHash: Schema.Number,
}) {}

/**
 * What confirming a build does to the subclass: equip it when it is not the
 * one on, then slot its plugs. It runs only when its item id is among the
 * selected ids, the same way a row does.
 */
export class SubclassChange extends Schema.Class<SubclassChange>("SubclassChange")({
  itemInstanceId: Schema.String,
  itemHash: Schema.Number,
  characterId: Schema.String,
  /** The equipped subclass this one takes over from; null when it is already on. */
  replaces: Schema.NullOr(Schema.String),
  previousItemId: Schema.NullOr(Schema.String),
  swaps: Schema.Array(SubclassSwap),
  /** Ghost's default, as on a row. */
  selected: Schema.Boolean,
  outcome: Schema.NullOr(RowOutcome),
  error: Schema.NullOr(Schema.String),
}) {}

/** A character's subclass: what it has slotted, or what a build slots. */
export class SubclassLoadout extends Schema.Class<SubclassLoadout>("SubclassLoadout")({
  classType: GuardianClass,
  subclass: Schema.NullOr(Schema.String),
  /** The subclass's own emblem; missing from plans made before it was recorded. */
  icon: Schema.optional(Schema.NullOr(Schema.String)),
  element: DamageType,
  super: Schema.NullOr(LoadoutPlug),
  abilities: Schema.optional(Schema.Array(LoadoutAbility)),
  aspects: Schema.Array(LoadoutPlug),
  fragments: Schema.Array(LoadoutPlug),
  /** Present when the build equips this subclass or changes its plugs. */
  change: Schema.optional(SubclassChange),
}) {}

/**
 * One armor set bonus from the current patch's manifest. It is on when the
 * pieces worn reach the pieces it needs; below that it is one the build or
 * piece is short of.
 */
export class SetBonus extends Schema.Class<SetBonus>("SetBonus")({
  name: Schema.String,
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
  /** The armor set it belongs to, for example "Techsec". */
  set: Schema.String,
  /** Pieces of the set the bonus needs. */
  required: Schema.Number,
  /** Pieces of the set worn. */
  worn: Schema.Number,
  /** How well the bonus fits the build Ghost was asked for, from 0 to 1, when Jev judged it. */
  fit: Schema.optional(Schema.Number),
}) {}

/** Below this fit, Jev judges an active set bonus off-build: on real data clear misfits score under 0.2 and plausible fits 0.2 to 0.5. */
export const OFF_BUILD_FIT = 0.2

/** How each part of a build feeds the rest, in Ghost's words; a part the build lacks is left out. */
export class Synergy extends Schema.Class<Synergy>("Synergy")({
  exotic: Schema.optional(Schema.String),
  setBonuses: Schema.optional(Schema.String),
  mods: Schema.optional(Schema.String),
  weapons: Schema.optional(Schema.String),
  artifact: Schema.optional(Schema.String),
}) {}

/** The API cannot select artifact perks: one not already active is picked in game. */
export const ArtifactPickState = Schema.Literals(["active", "select_in_game"])
export type ArtifactPickState = typeof ArtifactPickState.Type

export class ArtifactPick extends Schema.Class<ArtifactPick>("ArtifactPick")({
  hash: Schema.Number,
  name: Schema.String,
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
  /** The artifact column the perk sits in, from 0. */
  column: Schema.Number,
  state: ArtifactPickState,
}) {}

export class ArtifactPlan extends Schema.Class<ArtifactPlan>("ArtifactPlan")({
  artifactHash: Schema.Number,
  name: Schema.String,
  picks: Schema.Array(ArtifactPick),
  pointsAvailable: Schema.Number,
  /** Fitting the picks means un-selecting active perks, which needs an in-game reset. */
  reset: Schema.Boolean,
}) {}

export const LoadoutSaveOutcome = Schema.Literals(["ok", "skipped", "failed"])
export type LoadoutSaveOutcome = typeof LoadoutSaveOutcome.Type

/**
 * After the rows run, snapshot what the character has equipped into one of
 * its in-game loadout slots. It runs only when the build ended up equipped
 * as planned.
 */
export class LoadoutSaveTo extends Schema.Class<LoadoutSaveTo>("LoadoutSaveTo")({
  buildId: Schema.String,
  characterId: Schema.String,
  index: Schema.Number,
  nameHash: Schema.Number,
  colorHash: Schema.Number,
  iconHash: Schema.Number,
  /** The name of the in-game loadout this overwrites; null for an empty slot. */
  replaces: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(LoadoutSaveOutcome),
  error: Schema.NullOr(Schema.String),
}) {}

export const PlanKind = Schema.Literals(["build", "weapon", "postmaster", "cleanup", "transfer"])
export type PlanKind = typeof PlanKind.Type

export const PlanStatus = Schema.Literals(["proposed", "applied", "undone"])
export type PlanStatus = typeof PlanStatus.Type

export class Plan extends Schema.Class<Plan>("Plan")({
  kind: PlanKind,
  /** Left side of the plan header, for example "BUILD PLAN". */
  title: Schema.String,
  /** Right side of the plan header, for example "GYRFALCON'S · VOID". */
  subtitle: Schema.NullOr(Schema.String),
  stats: Schema.Array(PlanStat),
  featured: Schema.NullOr(PlanFeatured),
  /** Present on builds made since the card started showing the subclass. */
  loadout: Schema.optional(SubclassLoadout),
  rows: Schema.Array(PlanRow),
  /** A closing line such as "Mods: 2× Discipline (chest, legs)." */
  note: Schema.NullOr(Schema.String),
  /** How the build's conditional bonuses, such as armor charge, play out together, in Ghost's words. */
  situational: Schema.optional(Schema.String),
  /** Armor set bonuses the build's pieces turn on, then those one piece away, fewest pieces needed first. */
  setBonuses: Schema.optional(Schema.Array(SetBonus)),
  synergy: Schema.optional(Synergy),
  /** Label of the confirm button, for example "APPLY BUILD". */
  confirmLabel: Schema.String,
  status: PlanStatus,
  purpose: Schema.optional(Schema.String),
  artifact: Schema.optional(ArtifactPlan),
  saveTo: Schema.optional(LoadoutSaveTo),
  /** The server kept what made this build, so it can be saved and equipped again. */
  saveable: Schema.optional(Schema.Boolean),
}) {}

// ---- Jobs: one request to Ghost ----

export const JobKind = Schema.Literals([
  "chat",
  "build_suggestion",
  "weapon_rolls",
  "vault_cleanup",
  "postmaster_to_vault",
  /** A move the player made by hand from an item's actions; Ghost never ran. */
  "item_action",
  /** Equipping a saved build, which the player started from Builds. */
  "saved_build",
])
export type JobKind = typeof JobKind.Type

export const JobStatus = Schema.Literals(["queued", "running", "done", "failed"])
export type JobStatus = typeof JobStatus.Type

/** One tool call Ghost made while answering, in the order it happened. */
export class JobStep extends Schema.Class<JobStep>("JobStep")({
  /** For example "Searching your items". */
  label: Schema.String,
  /** What it was looking for, for example the search text or a site name. */
  detail: Schema.NullOr(Schema.String),
}) {}

/** Something Ghost offered under its answer, drawn as a card the player can act on. */
export const JobOffer = Schema.Literals(["cleanup_mode"])
export type JobOffer = typeof JobOffer.Type

export class Job extends Schema.Class<Job>("Job")({
  id: Schema.String,
  /** The conversation this request belongs to; null for item actions. */
  sessionId: Schema.NullOr(Schema.String),
  kind: JobKind,
  prompt: Schema.String,
  status: JobStatus,
  steps: Schema.Array(JobStep),
  result: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  plan: Schema.NullOr(Plan),
  sources: Schema.Array(Source),
  characterId: Schema.NullOr(Schema.String),
  offer: Schema.NullOr(JobOffer),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export const CreateJob = Schema.Struct({
  kind: JobKind,
  prompt: Schema.String,
  /** The character selected in the app, so "equip this" has a target. */
  characterId: Schema.optional(Schema.NullOr(Schema.String)),
  /** The conversation to continue; leave it out to start a new one. */
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
})
export type CreateJob = typeof CreateJob.Type

/** One conversation with Ghost, named after its first request. */
export class ChatSession extends Schema.Class<ChatSession>("ChatSession")({
  id: Schema.String,
  title: Schema.String,
  startedAt: Schema.String,
  lastAt: Schema.String,
  count: Schema.Number,
}) {}

export const ApplyPlan = Schema.Struct({
  /** Instance ids of the rows the player left ticked. */
  selected: Schema.Array(Schema.String),
})
export type ApplyPlan = typeof ApplyPlan.Type

export class JobNotFound extends Schema.TaggedError<JobNotFound>()("JobNotFound", {
  id: Schema.String,
}) {}

export class PlanNotApplicable extends Schema.TaggedError<PlanNotApplicable>()(
  "PlanNotApplicable",
  { reason: Schema.String },
) {}

export class BuildFacets extends Schema.Class<BuildFacets>("BuildFacets")({
  classType: GuardianClass,
  element: DamageType,
  subclass: Schema.NullOr(Schema.String),
  exoticArmor: Schema.NullOr(Schema.String),
  exoticWeapon: Schema.NullOr(Schema.String),
  weaponTypes: Schema.Array(Schema.String),
}) {}

/** How the in-game slot a build was saved to compares with the build now. */
export const InGameState = Schema.Literals(["matches", "changed", "cleared"])
export type InGameState = typeof InGameState.Type

export class BuildReadiness extends Schema.Class<BuildReadiness>("BuildReadiness")({
  /** Names of the build's items the player no longer owns. */
  missing: Schema.Array(Schema.String),
  /** The build's artifact picks belong to an artifact that is no longer the current one. */
  pastArtifact: Schema.Boolean,
  /** Null when the build was never saved in game. */
  inGame: Schema.NullOr(InGameState),
}) {}

export class InGameSlotRef extends Schema.Class<InGameSlotRef>("InGameSlotRef")({
  characterId: Schema.String,
  index: Schema.Number,
  savedAt: Schema.String,
}) {}

export class SavedBuild extends Schema.Class<SavedBuild>("SavedBuild")({
  id: Schema.String,
  name: Schema.String,
  plan: Plan,
  facets: BuildFacets,
  /** Null when Bungie could not be reached, so the list still loads. */
  readiness: Schema.NullOr(BuildReadiness),
  inGame: Schema.NullOr(InGameSlotRef),
  /** The request that proposed the build; null once that job is gone. */
  jobId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export const LoadoutSlotChoice = Schema.Struct({
  characterId: Schema.String,
  index: Schema.Number,
  nameHash: Schema.Number,
  colorHash: Schema.Number,
  iconHash: Schema.Number,
})
export type LoadoutSlotChoice = typeof LoadoutSlotChoice.Type

export const SaveBuild = Schema.Struct({
  /** The job whose build plan to save. Saving it again renames the saved build. */
  jobId: Schema.String,
  name: Schema.String,
  /** Also save it in game; this returns a plan to confirm that equips and snapshots it. */
  inGame: Schema.optional(LoadoutSlotChoice),
})
export type SaveBuild = typeof SaveBuild.Type

export class SaveBuildResult extends Schema.Class<SaveBuildResult>("SaveBuildResult")({
  build: SavedBuild,
  /** The proposed equip-and-snapshot job when saving in game, else null. */
  confirm: Schema.NullOr(Job),
}) {}

export const EquipBuild = Schema.Struct({
  characterId: Schema.String,
  saveTo: Schema.optional(LoadoutSlotChoice),
})
export type EquipBuild = typeof EquipBuild.Type

export class EquipBuildResult extends Schema.Class<EquipBuildResult>("EquipBuildResult")({
  /** A proposed job; nothing moves until the player confirms it. */
  job: Job,
  /** Items swapped for another owned copy of the same item because the saved one is gone. */
  substituted: Schema.Array(Schema.String),
}) {}

export const RenameBuild = Schema.Struct({ name: Schema.String })
export type RenameBuild = typeof RenameBuild.Type

export class LoadoutIdentity extends Schema.Class<LoadoutIdentity>("LoadoutIdentity")({
  hash: Schema.Number,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
}) {}

export class InGameSlot extends Schema.Class<InGameSlot>("InGameSlot")({
  index: Schema.Number,
  empty: Schema.Boolean,
  name: Schema.NullOr(LoadoutIdentity),
  color: Schema.NullOr(LoadoutIdentity),
  icon: Schema.NullOr(LoadoutIdentity),
  savedBuildId: Schema.NullOr(Schema.String),
}) {}

export class LoadoutSlots extends Schema.Class<LoadoutSlots>("LoadoutSlots")({
  slots: Schema.Array(InGameSlot),
  names: Schema.Array(LoadoutIdentity),
  colors: Schema.Array(LoadoutIdentity),
  icons: Schema.Array(LoadoutIdentity),
}) {}

export class BuildNotFound extends Schema.TaggedError<BuildNotFound>()("BuildNotFound", {
  id: Schema.String,
}) {}

export class LoadoutSlotInvalid extends Schema.TaggedError<LoadoutSlotInvalid>()(
  "LoadoutSlotInvalid",
  { reason: Schema.String },
) {}

// ---- Recent acquisitions ----

export class RecentItem extends Schema.Class<RecentItem>("RecentItem")({
  itemInstanceId: Schema.String,
  itemHash: Schema.Number,
  name: Schema.NullOr(Schema.String),
  typeName: Schema.String,
  /** Absolute bungie.net URL of the item's icon, when the manifest has one. */
  icon: Schema.NullOr(Schema.String),
  tier: ItemTier,
  slot: ItemSlot,
  power: Schema.NullOr(Schema.Number),
  damageType: Schema.optional(DamageType),
  masterwork: Schema.optional(Schema.Boolean),
  gearTier: Schema.optional(Schema.NullOr(Schema.Number)),
  location: ItemLocation,
  source: Schema.String,
  decision: Schema.NullOr(ItemDecision),
  /** Beats what the selected character has equipped in the same slot. */
  upgrade: Schema.Boolean,
  /** The Ghost request that moved it, so the batch can be undone together. */
  jobId: Schema.NullOr(Schema.String),
  firstSeenAt: Schema.String,
  lastSeenAt: Schema.String,
}) {}

export const SetDecision = Schema.Struct({
  decision: Schema.NullOr(ItemDecision),
})
export type SetDecision = typeof SetDecision.Type

export class ItemPerk extends Schema.Class<ItemPerk>("ItemPerk")({
  name: Schema.String,
  /** Effect text from the current patch's manifest. */
  description: Schema.String,
  icon: Schema.NullOr(Schema.String),
  /** A trait perk, the kind that makes a roll, as opposed to a barrel or mod. */
  trait: Schema.Boolean,
  /** The enhanced version of the perk, from crafting or enhancing. */
  enhanced: Schema.optional(Schema.Boolean),
}) {}

export class ItemDetail extends Schema.Class<ItemDetail>("ItemDetail")({
  item: ItemSummary,
  /** Every plug in a weapon's sockets, in socket order. */
  perks: Schema.Array(ItemPerk),
  /** The six armor stats; empty for weapons. */
  stats: Schema.Array(PlanStat),
  /** Every bonus of the armor set the piece belongs to, counting the set pieces its character wears; absent when it is in no set. */
  setBonuses: Schema.optional(Schema.Array(SetBonus)),
  /** Exotic armor's intrinsic perk. */
  exoticPerk: Schema.optional(ItemPerk),
}) {}

export class ItemNotFound extends Schema.TaggedError<ItemNotFound>()("ItemNotFound", {
  id: Schema.String,
}) {}

/** A move the player asks for directly; it runs at once and can be undone from History. */
export const ItemAction = Schema.Struct({
  action: Schema.Literals(["to_vault", "to_character", "equip"]),
  /** Target character for to_character and equip. */
  characterId: Schema.optional(Schema.NullOr(Schema.String)),
})
export type ItemAction = typeof ItemAction.Type

// ---- Health and Bungie auth ----

export const AgentEffort = Schema.Literals(["low", "medium", "high", "xhigh", "max"])
export type AgentEffort = typeof AgentEffort.Type

/** How Ghost's agent is set up to answer. */
export class AgentSettings extends Schema.Class<AgentSettings>("AgentSettings")({
  model: Schema.String,
  /** How hard Ghost thinks before answering; higher is slower and more thorough. */
  effort: AgentEffort,
}) {}

export const SetAgentSettings = Schema.Struct({ effort: AgentEffort })
export type SetAgentSettings = typeof SetAgentSettings.Type

export class Health extends Schema.Class<Health>("Health")({
  ok: Schema.Boolean,
  version: Schema.String,
  bungieLinked: Schema.Boolean,
}) {}

export class BungieAuthStart extends Schema.Class<BungieAuthStart>("BungieAuthStart")({
  url: Schema.String,
}) {}

export class BungieAuthResult extends Schema.Class<BungieAuthResult>("BungieAuthResult")({
  membershipId: Schema.String,
  displayName: Schema.String,
}) {}

export class BungieAuthFailed extends Schema.TaggedError<BungieAuthFailed>()("BungieAuthFailed", {
  reason: Schema.String,
}) {}

export class BungieNotLinked extends Schema.TaggedError<BungieNotLinked>()("BungieNotLinked", {}) {}

export class BungieFailed extends Schema.TaggedError<BungieFailed>()("BungieFailed", {
  message: Schema.String,
}) {}

// ---- Guardian and vault ----

export class CharacterStats extends Schema.Class<CharacterStats>("CharacterStats")({
  mobility: Schema.Number,
  resilience: Schema.Number,
  recovery: Schema.Number,
  discipline: Schema.Number,
  intellect: Schema.Number,
  strength: Schema.Number,
}) {}

export class GuardianCharacter extends Schema.Class<GuardianCharacter>("GuardianCharacter")({
  characterId: Schema.String,
  classType: GuardianClass,
  light: Schema.Number,
  /** Name of the equipped subclass, for example "Nightstalker". */
  subclass: Schema.NullOr(Schema.String),
  element: DamageType,
  /** Art of the equipped Ghost shell. */
  ghostIcon: Schema.optional(Schema.NullOr(Schema.String)),
  /** Missing only from a snapshot the app cached before subclasses were described. */
  loadout: Schema.optional(SubclassLoadout),
  stats: CharacterStats,
  equipment: Schema.Array(ItemSummary),
  /** Weapons and armor in the character's inventory, not equipped. Missing from snapshots cached before it was sent. */
  carried: Schema.optional(Schema.Array(ItemSummary)),
  postmasterCount: Schema.Number,
}) {}

/** The armor charge mods a character has on, and Ghost's read on what its conditional bonuses add. */
export class GuardianSituational extends Schema.Class<GuardianSituational>("GuardianSituational")({
  mods: Schema.Array(ArmorMod),
  /** Null when the character runs no charge mods, Ghost could not write it, or it is still being written. */
  summary: Schema.NullOr(Schema.String),
  /** Ghost is looking up numbers or writing the summary; ask again shortly. */
  pending: Schema.Boolean,
}) {}

export class GuardianSnapshot extends Schema.Class<GuardianSnapshot>("GuardianSnapshot")({
  characters: Schema.Array(GuardianCharacter),
  vaultCount: Schema.Number,
  vaultCapacity: Schema.Number,
  postmasterCapacity: Schema.Number,
  /** Bungie's icon for each damage type, keyed by element name. */
  elementIcons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Bungie's icon for each armor stat, keyed by stat name ("Weapons", "Health"…). */
  statIcons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class VaultSnapshot extends Schema.Class<VaultSnapshot>("VaultSnapshot")({
  count: Schema.Number,
  capacity: Schema.Number,
  items: Schema.Array(ItemSummary),
}) {}

// ---- "Since last time" briefing ----

/**
 * What changed since the player last opened Ghost. The server decides when
 * a new session starts (a long enough gap since the last request), so the
 * numbers stay stable while the app is open and refetching.
 */
export class Briefing extends Schema.Class<Briefing>("Briefing")({
  /** Start of the comparison window; null on the very first sync. */
  since: Schema.NullOr(Schema.String),
  newCount: Schema.Number,
  /** New items that beat what the selected character has on. */
  upgrades: Schema.Array(ItemSummary),
  postmasterCount: Schema.Number,
  postmasterCapacity: Schema.Number,
  vaultCount: Schema.Number,
  vaultCapacity: Schema.Number,
  /** Items first seen in the last 48 hours, and how many still have no keep/junk call. */
  recentCount: Schema.Number,
  undecidedCount: Schema.Number,
  /** Item moves Ghost made today. */
  actionsToday: Schema.Number,
}) {}

// ---- History: every call Ghost made, grouped by request ----

export const ActionStatus = Schema.Literals(["ok", "failed", "held", "undone"])
export type ActionStatus = typeof ActionStatus.Type

export class HistoryCall extends Schema.Class<HistoryCall>("HistoryCall")({
  /** For example "transferItem → vault ×7". */
  label: Schema.String,
  status: ActionStatus,
}) {}

export class HistoryGroup extends Schema.Class<HistoryGroup>("HistoryGroup")({
  jobId: Schema.String,
  prompt: Schema.String,
  at: Schema.String,
  calls: Schema.Array(HistoryCall),
  undoable: Schema.Boolean,
  undone: Schema.Boolean,
}) {}

// ---- Cleanup mode: Ghost hands junk over in batches, the player deletes in game ----

export const GearSlot = Schema.Literals([
  "kinetic",
  "energy",
  "power",
  "helmet",
  "arms",
  "chest",
  "legs",
  "class",
])
export type GearSlot = typeof GearSlot.Type

/**
 * stopped and closed end a session; finished waits for the player to return
 * their gear or leave it in the vault.
 */
export const CleanupStage = Schema.Literals([
  "stashing",
  "delivering",
  "paused",
  "finished",
  "returning",
  "closed",
  "stopped",
])
export type CleanupStage = typeof CleanupStage.Type

export const StashState = Schema.Literals(["queued", "moving", "in_vault", "returned", "failed"])
export type StashState = typeof StashState.Type

/** keeping and skipping are on their way back to the vault; kept and skipped are there. */
export const JunkState = Schema.Literals([
  "waiting",
  "moving",
  "in_hand",
  "keeping",
  "kept",
  "skipping",
  "skipped",
  "deleted",
  "failed",
])
export type JunkState = typeof JunkState.Type

const cleanupItemFields = {
  itemInstanceId: Schema.String,
  itemHash: Schema.Number,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
  slot: GearSlot,
  damageType: DamageType,
  gearTier: Schema.NullOr(Schema.Number),
  masterwork: Schema.Boolean,
  /** One line under the name, for example "Shotgun · Duplicate". */
  meta: Schema.String,
}

export class StashEntry extends Schema.Class<StashEntry>("StashEntry")({
  ...cleanupItemFields,
  junk: Schema.Boolean,
  state: StashState,
}) {}

export class JunkEntry extends Schema.Class<JunkEntry>("JunkEntry")({
  ...cleanupItemFields,
  batch: Schema.Number,
  state: JunkState,
}) {}

export class CleanupSession extends Schema.Class<CleanupSession>("CleanupSession")({
  id: Schema.String,
  characterId: Schema.String,
  stage: CleanupStage,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  /** The batch on the character now, from 0. */
  batch: Schema.Number,
  batches: Schema.Number,
  stash: Schema.Array(StashEntry),
  junk: Schema.Array(JunkEntry),
  /** Junk that is equipped, which Ghost cannot move; skipped and named. */
  equippedJunk: Schema.Array(Schema.String),
  vault: Schema.Struct({ before: Schema.Number, capacity: Schema.Number }),
  /** Why the last move failed, until one succeeds. */
  error: Schema.NullOr(Schema.String),
}) {}

export class CleanupPreview extends Schema.Class<CleanupPreview>("CleanupPreview")({
  characterId: Schema.String,
  junk: Schema.Number,
  batches: Schema.Number,
  stash: Schema.Number,
  /** Carried items that are not junk, which can go back at the end. */
  returnable: Schema.Number,
  equippedJunk: Schema.Array(Schema.String),
  vault: Schema.Struct({ count: Schema.Number, capacity: Schema.Number, after: Schema.Number }),
  fits: Schema.Boolean,
}) {}

export const StartCleanup = Schema.Struct({ characterId: Schema.String })
export type StartCleanup = typeof StartCleanup.Type

/** Flagged as junk, but something argues for keeping it, so the player decides. */
export class ReviewItem extends Schema.Class<ReviewItem>("ReviewItem")({
  ...cleanupItemFields,
  reason: Schema.String,
}) {}

export const PerkRating = Schema.Literals(["good", "ok", "junk"])
export type PerkRating = typeof PerkRating.Type

/** Who rated a perk, strongest first. */
export const PerkRatingSource = Schema.Literals(["player", "claude", "wishlist", "community"])
export type PerkRatingSource = typeof PerkRatingSource.Type

export class RatedPerk extends Schema.Class<RatedPerk>("RatedPerk")({
  name: Schema.String,
  rating: PerkRating,
  /** null when nothing rates the perk, which makes it junk. */
  source: Schema.NullOr(PerkRatingSource),
}) {}

/** A weapon's trait columns, every perk each can slot, rated the way junk judging rates them. */
export class WeaponPerks extends Schema.Class<WeaponPerks>("WeaponPerks")({
  weapon: Schema.String,
  columns: Schema.Array(Schema.Array(RatedPerk)),
}) {}

/** null drops the player's rating, leaving Claude's or the wishlist's. */
export const SetPerkRating = Schema.Struct({
  perk: Schema.String,
  rating: Schema.NullOr(PerkRating),
})
export type SetPerkRating = typeof SetPerkRating.Type

export class JudgeUnavailable extends Schema.TaggedError<JudgeUnavailable>()("JudgeUnavailable", {
  reason: Schema.String,
}) {}

export const KeepFromCleanup = Schema.Struct({ itemIds: Schema.NonEmptyArray(Schema.String) })
export type KeepFromCleanup = typeof KeepFromCleanup.Type

export class CleanupNotFound extends Schema.TaggedError<CleanupNotFound>()("CleanupNotFound", {
  id: Schema.String,
}) {}

export class CleanupRefused extends Schema.TaggedError<CleanupRefused>()("CleanupRefused", {
  reason: Schema.String,
}) {}
