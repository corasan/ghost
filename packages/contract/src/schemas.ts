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

export const GuardianClass = Schema.Literals(["titan", "hunter", "warlock"])
export type GuardianClass = typeof GuardianClass.Type

export const ItemDecision = Schema.Literals(["keep", "junk"])
export type ItemDecision = typeof ItemDecision.Type

/**
 * One owned item, wherever it lives. Everything the app filters on is a
 * field here, so the vault screen can slice 600 items locally without
 * asking the server again.
 */
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
  /** In a build, what the character has in this stat before the build is applied. */
  before: Schema.optional(Schema.Number),
  /** In a build, what the stat does, in Bungie's words for the current patch. */
  effect: Schema.optional(Schema.String),
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
  /** Ghost's default. The player can untick it before confirming. */
  selected: Schema.Boolean,
  outcome: Schema.NullOr(RowOutcome),
  error: Schema.NullOr(Schema.String),
  /** The six stats of an armor piece; left out for weapons. */
  stats: Schema.optional(Schema.Array(PlanStat)),
  slot: Schema.optional(ItemSlot),
  masterwork: Schema.optional(Schema.Boolean),
  damageType: Schema.optional(DamageType),
  gearTier: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Where a piece comes from when it is not already on the character, for example "VAULT" or "HUNTER". */
  origin: Schema.optional(Schema.String),
}) {}

export class PlanPerk extends Schema.Class<PlanPerk>("PlanPerk")({
  name: Schema.String,
  /** Highlighted as part of what makes the roll good. */
  good: Schema.Boolean,
}) {}

/** The winner of a "best weapon" answer, shown large above the runners-up. */
export class PlanFeatured extends Schema.Class<PlanFeatured>("PlanFeatured")({
  itemInstanceId: Schema.String,
  perks: Schema.Array(PlanPerk),
  stats: Schema.Array(PlanStat),
}) {}

/** How far one subclass plug moves one stat. */
export class StatMod extends Schema.Class<StatMod>("StatMod")({
  /** The stat's label as it appears in the plan's stats. */
  label: Schema.String,
  delta: Schema.Number,
}) {}

export class LoadoutPlug extends Schema.Class<LoadoutPlug>("LoadoutPlug")({
  name: Schema.String,
  /** Effect text from the current patch's manifest. */
  description: Schema.String,
  icon: Schema.optional(Schema.NullOr(Schema.String)),
  mods: Schema.Array(StatMod),
  /** How many fragment slots an aspect brings. */
  fragmentSlots: Schema.optional(Schema.Number),
}) {}

export const AbilityKind = Schema.Literals(["class", "jump", "melee", "grenade"])
export type AbilityKind = typeof AbilityKind.Type

export class LoadoutAbility extends Schema.Class<LoadoutAbility>("LoadoutAbility")({
  kind: AbilityKind,
  name: Schema.String,
  icon: Schema.NullOr(Schema.String),
}) {}

/** What a character has slotted on its subclass, read from the game. */
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
  /** Label of the confirm button, for example "APPLY BUILD". */
  confirmLabel: Schema.String,
  status: PlanStatus,
}) {}

// ---- Jobs: one request to Ghost ----

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

export const JobKind = Schema.Literals([
  "chat",
  "build_suggestion",
  "weapon_rolls",
  "vault_cleanup",
  "postmaster_to_vault",
  /** A move the player made by hand from an item's actions; Ghost never ran. */
  "item_action",
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
}) {}

export class ItemDetail extends Schema.Class<ItemDetail>("ItemDetail")({
  item: ItemSummary,
  /** Every plug in a weapon's sockets, in socket order. */
  perks: Schema.Array(ItemPerk),
  /** The six armor stats; empty for weapons. */
  stats: Schema.Array(PlanStat),
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
  postmasterCount: Schema.Number,
}) {}

export class GuardianSnapshot extends Schema.Class<GuardianSnapshot>("GuardianSnapshot")({
  characters: Schema.Array(GuardianCharacter),
  vaultCount: Schema.Number,
  vaultCapacity: Schema.Number,
  postmasterCapacity: Schema.Number,
  /** Bungie's icon for each damage type, keyed by element name. */
  elementIcons: Schema.optional(Schema.Record(Schema.String, Schema.String)),
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
