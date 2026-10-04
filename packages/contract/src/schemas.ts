import { Schema } from "effect"

// Shared wire types. Both the server (to validate and encode) and the app
// (to decode) derive their TypeScript types from these, so a field rename
// here is a compile error on both sides instead of a runtime surprise.

export const JobKind = Schema.Literals([
  "chat",
  "build_suggestion",
  "weapon_rolls",
  "vault_cleanup",
  "postmaster_to_vault",
])
export type JobKind = typeof JobKind.Type

export const JobStatus = Schema.Literals(["queued", "running", "done", "failed"])
export type JobStatus = typeof JobStatus.Type

export class Job extends Schema.Class<Job>("Job")({
  id: Schema.String,
  kind: JobKind,
  prompt: Schema.String,
  status: JobStatus,
  result: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export class CreateJob extends Schema.Class<CreateJob>("CreateJob")({
  kind: JobKind,
  prompt: Schema.String,
}) {}

export class JobNotFound extends Schema.TaggedError<JobNotFound>()("JobNotFound", {
  id: Schema.String,
}) {}

export const ItemLocation = Schema.Literals(["postmaster", "character", "vault"])
export type ItemLocation = typeof ItemLocation.Type

export class RecentItem extends Schema.Class<RecentItem>("RecentItem")({
  itemInstanceId: Schema.String,
  itemHash: Schema.Number,
  name: Schema.NullOr(Schema.String),
  location: ItemLocation,
  source: Schema.String,
  decision: Schema.NullOr(Schema.Literals(["keep", "junk"])),
  firstSeenAt: Schema.String,
  lastSeenAt: Schema.String,
}) {}

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

// ---- Guardian, vault, and manifest-backed item data ----

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
}) {}

export const GuardianClass = Schema.Literals(["titan", "hunter", "warlock"])
export type GuardianClass = typeof GuardianClass.Type

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
  stats: CharacterStats,
  equipment: Schema.Array(ItemSummary),
  postmasterCount: Schema.Number,
}) {}

export class GuardianSnapshot extends Schema.Class<GuardianSnapshot>("GuardianSnapshot")({
  characters: Schema.Array(GuardianCharacter),
  vaultCount: Schema.Number,
  vaultCapacity: Schema.Number,
}) {}

export class VaultSnapshot extends Schema.Class<VaultSnapshot>("VaultSnapshot")({
  count: Schema.Number,
  capacity: Schema.Number,
  items: Schema.Array(ItemSummary),
}) {}

export class BungieNotLinked extends Schema.TaggedError<BungieNotLinked>()("BungieNotLinked", {}) {}

export class BungieFailed extends Schema.TaggedError<BungieFailed>()("BungieFailed", {
  message: Schema.String,
}) {}

export const ItemDecision = Schema.Literals(["keep", "junk"])
export type ItemDecision = typeof ItemDecision.Type

export class SetDecision extends Schema.Class<SetDecision>("SetDecision")({
  decision: Schema.NullOr(ItemDecision),
}) {}
