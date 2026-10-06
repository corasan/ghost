import { ArtifactPick, ArtifactPlan, type BungieNotLinked } from "@ghost/contract"
import { Context, Effect, Layer, Schema } from "effect"
import { BungieClient, type BungieError } from "./client.ts"
import { Manifest } from "./manifest.ts"
import { ProfileStore } from "./profile.ts"

/** Read on demand: the artifact changes only in game, so the hot profile read leaves it out. */
export const ARTIFACT_COMPONENTS = [104, 202]

const component = <S extends Schema.Top>(data: S) =>
  Schema.optional(Schema.Struct({ data: Schema.optional(data) }))

export const ArtifactProfile = Schema.Struct({
  profileProgression: component(
    Schema.Struct({
      seasonalArtifact: Schema.optional(
        Schema.Struct({
          artifactHash: Schema.Number,
          pointsAcquired: Schema.optional(Schema.Number),
          pointProgression: Schema.optional(Schema.Struct({ level: Schema.Number })),
        }),
      ),
    }),
  ),
  characterProgressions: component(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        seasonalArtifact: Schema.optional(
          Schema.Struct({
            artifactHash: Schema.Number,
            pointsUsed: Schema.Number,
            tiers: Schema.Array(
              Schema.Struct({
                tierHash: Schema.Number,
                isUnlocked: Schema.Boolean,
                pointsToUnlock: Schema.Number,
                items: Schema.Array(
                  Schema.Struct({
                    itemHash: Schema.Number,
                    isActive: Schema.Boolean,
                    isVisible: Schema.optional(Schema.Boolean),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
})
export type ArtifactProfile = typeof ArtifactProfile.Type

const ArtifactDefinition = Schema.Struct({
  displayProperties: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
  tiers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        tierHash: Schema.Number,
        minimumUnlockPointsUsedRequirement: Schema.optional(Schema.Number),
      }),
    ),
  ),
})
export type ArtifactDefinition = typeof ArtifactDefinition.Type

export interface ArtifactPerk {
  readonly hash: number
  readonly name: string
  readonly description: string
  readonly icon: string | null
  readonly active: boolean
}

export interface ArtifactColumn {
  /** From 0, left to right in game. */
  readonly column: number
  readonly unlocked: boolean
  /** Points spent in earlier columns before this one opens. */
  readonly unlocksAt: number
  readonly perks: ReadonlyArray<ArtifactPerk>
}

/** One character's seasonal artifact: the points it has to spend and every perk it offers. */
export interface CharacterArtifact {
  readonly artifactHash: number
  readonly name: string
  /** Shared by every character on the account. */
  readonly pointsAvailable: number
  readonly pointsUsed: number
  readonly tiers: ReadonlyArray<ArtifactColumn>
}

export type PerkFacts = Pick<ArtifactPerk, "name" | "description" | "icon">

/**
 * The character's artifact, or null when it has none. Bungie's own
 * pointsToUnlock counts down as points are spent, so when a column opens comes
 * from the artifact definition instead.
 */
export const parseArtifact = (
  profile: ArtifactProfile,
  characterId: string,
  definition: ArtifactDefinition,
  perkFacts: (hash: number) => PerkFacts | undefined,
): CharacterArtifact | null => {
  const scoped = profile.characterProgressions?.data?.[characterId]?.seasonalArtifact
  if (scoped === undefined) return null
  const account = profile.profileProgression?.data?.seasonalArtifact
  const unlocksAt = new Map(
    (definition.tiers ?? []).map((tier) => [
      tier.tierHash,
      tier.minimumUnlockPointsUsedRequirement ?? 0,
    ]),
  )
  return {
    artifactHash: scoped.artifactHash,
    name: definition.displayProperties?.name ?? "Seasonal Artifact",
    pointsAvailable: Math.max(account?.pointsAcquired ?? 0, account?.pointProgression?.level ?? 0),
    pointsUsed: scoped.pointsUsed,
    tiers: scoped.tiers.map((tier, column) => ({
      column,
      unlocked: tier.isUnlocked,
      unlocksAt: unlocksAt.get(tier.tierHash) ?? tier.pointsToUnlock,
      perks: tier.items.flatMap((item) => {
        const facts = perkFacts(item.itemHash)
        return item.isVisible === false || facts === undefined
          ? []
          : [{ hash: item.itemHash, ...facts, active: item.isActive }]
      }),
    })),
  }
}

type PlacedPerk = ArtifactPerk & { readonly column: number }

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Why each perk of a selection cannot be reached, opening columns left to right. */
const unreachable = (selection: ReadonlyArray<PlacedPerk>, tiers: ReadonlyArray<ArtifactColumn>) =>
  selection.flatMap((perk) => {
    const opensAt = tiers[perk.column]?.unlocksAt ?? 0
    const before = selection.filter((other) => other.column < perk.column).length
    return before < opensAt
      ? [
          `"${perk.name}" sits in column ${perk.column + 1}, which opens after ${opensAt} points in earlier columns, and the picks put ${before} there`,
        ]
      : []
  })

const problems = (selection: ReadonlyArray<PlacedPerk>, artifact: CharacterArtifact) => [
  ...unreachable(selection, artifact.tiers),
  ...(selection.length > artifact.pointsAvailable
    ? [
        `the picks take ${selection.length} points and ${artifact.name} has ${artifact.pointsAvailable}`,
      ]
    : []),
]

/**
 * The artifact perks a build asks for, read against the character's
 * artifact. Picks join the active perks when they fit beside them; when they
 * do not, the plan says the player must reset the artifact in game first.
 */
export const planArtifact = (
  artifact: CharacterArtifact,
  names: ReadonlyArray<string>,
): ArtifactPlan | { readonly errors: ReadonlyArray<string> } => {
  const perks = artifact.tiers.flatMap((tier) =>
    tier.perks.map((perk): PlacedPerk => ({ ...perk, column: tier.column })),
  )
  const unknown = names.filter((name) => !perks.some((perk) => same(perk.name, name)))
  if (unknown.length > 0) {
    return { errors: unknown.map((name) => `"${name}" is not a perk on ${artifact.name}`) }
  }
  const picks = perks.filter((perk) => names.some((name) => same(perk.name, name)))
  const kept = perks.filter((perk) => perk.active || picks.includes(perk))
  const reset = problems(kept, artifact).length > 0
  const errors = reset ? problems(picks, artifact) : []
  if (errors.length > 0) return { errors }
  return new ArtifactPlan({
    artifactHash: artifact.artifactHash,
    name: artifact.name,
    picks: picks.map(
      (perk) =>
        new ArtifactPick({
          hash: perk.hash,
          name: perk.name,
          description: perk.description,
          icon: perk.icon,
          column: perk.column,
          state: perk.active ? "active" : "select_in_game",
        }),
    ),
    pointsAvailable: artifact.pointsAvailable,
    reset,
  })
}

export interface ArtifactsService {
  /** The character's artifact, or null when it has none. */
  readonly forCharacter: (
    characterId: string,
  ) => Effect.Effect<CharacterArtifact | null, BungieError | BungieNotLinked>
}

export class Artifacts extends Context.Service<Artifacts, ArtifactsService>()("Artifacts") {}

export const ArtifactsLive = Layer.effect(
  Artifacts,
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const manifest = yield* Manifest
    const profiles = yield* ProfileStore
    const definitions = new Map<number, ArtifactDefinition>()

    const decodeFailure = (cause: unknown) =>
      Effect.die(new Error(`unexpected Bungie response: ${String(cause)}`))

    const load = Effect.gen(function* () {
      const { membershipType, membershipId } = yield* profiles.inventory
      const raw = yield* bungie.get(
        `/Destiny2/${membershipType}/Profile/${membershipId}/?components=${ARTIFACT_COMPONENTS.join(",")}`,
      )
      return yield* Schema.decodeUnknownEffect(ArtifactProfile)(raw).pipe(
        Effect.catch(decodeFailure),
      )
    })

    const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(load, "30 seconds")
    const loaded = cached.pipe(Effect.tapError(() => invalidate))

    const definition = (hash: number) =>
      Effect.gen(function* () {
        const known = definitions.get(hash)
        if (known !== undefined) return known
        const raw = yield* bungie.get(`/Destiny2/Manifest/DestinyArtifactDefinition/${hash}/`)
        const decoded = yield* Schema.decodeUnknownEffect(ArtifactDefinition)(raw).pipe(
          Effect.catch(decodeFailure),
        )
        definitions.set(hash, decoded)
        return decoded
      })

    const forCharacter = (characterId: string) =>
      Effect.gen(function* () {
        const profile = yield* loaded
        const scoped = profile.characterProgressions?.data?.[characterId]?.seasonalArtifact
        if (scoped === undefined) return null
        const hashes = scoped.tiers.flatMap((tier) => tier.items.map((item) => item.itemHash))
        const defs = yield* manifest.lookup(hashes)
        const facts = yield* manifest.plugFacts(hashes)
        return parseArtifact(
          profile,
          characterId,
          yield* definition(scoped.artifactHash),
          (hash) => {
            const def = defs.get(hash)
            return def === undefined
              ? undefined
              : {
                  name: def.name,
                  description: facts.get(hash)?.description || def.description,
                  icon: def.icon,
                }
          },
        )
      })

    return { forCharacter }
  }),
)
