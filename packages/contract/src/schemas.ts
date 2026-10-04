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
