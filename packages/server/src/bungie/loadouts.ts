import {
  type BungieNotLinked,
  InGameSlot,
  LoadoutIdentity,
  type LoadoutSlotChoice,
  LoadoutSlotInvalid,
  LoadoutSlots,
} from "@ghost/contract"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AppConfig } from "../config.ts"
import { BungieError, BungieClient } from "./client.ts"
import { ProfileStore } from "./profile.ts"

const EMPTY_ID = "0"

const component = <S extends Schema.Top>(data: S) =>
  Schema.optional(Schema.Struct({ data: Schema.optional(data) }))

const RawLoadout = Schema.Struct({
  colorHash: Schema.Number,
  iconHash: Schema.Number,
  nameHash: Schema.Number,
  items: Schema.Array(
    Schema.Struct({ itemInstanceId: Schema.String, plugItemHashes: Schema.Array(Schema.Number) }),
  ),
})

/** Components 206 (character loadouts) and 104 (profile progression, for the current artifact). */
export const LOADOUT_COMPONENTS = [104, 206]

export const LoadoutsResponse = Schema.Struct({
  characterLoadouts: component(
    Schema.Record(Schema.String, Schema.Struct({ loadouts: Schema.Array(RawLoadout) })),
  ),
  profileProgression: component(
    Schema.Struct({
      seasonalArtifact: Schema.optional(Schema.Struct({ artifactHash: Schema.Number })),
    }),
  ),
})
export type LoadoutsResponse = typeof LoadoutsResponse.Type

export interface GameLoadout {
  readonly index: number
  readonly nameHash: number
  readonly colorHash: number
  readonly iconHash: number
  /** Empty for a slot nothing was saved to. */
  readonly itemInstanceIds: ReadonlyArray<string>
}

export interface GameLoadouts {
  readonly byCharacter: ReadonlyMap<string, ReadonlyArray<GameLoadout>>
  /** The seasonal artifact every character carries now; null when Bungie did not say. */
  readonly artifactHash: number | null
}

export const isEmptyLoadout = (loadout: GameLoadout) => loadout.itemInstanceIds.length === 0

export const parseLoadouts = (response: LoadoutsResponse): GameLoadouts => ({
  byCharacter: new Map(
    Object.entries(response.characterLoadouts?.data ?? {}).map(([characterId, character]) => [
      characterId,
      character.loadouts.map((loadout, index) => ({
        index,
        nameHash: loadout.nameHash,
        colorHash: loadout.colorHash,
        iconHash: loadout.iconHash,
        itemInstanceIds: loadout.items
          .map((item) => item.itemInstanceId)
          .filter((id) => id !== EMPTY_ID),
      })),
    ]),
  ),
  artifactHash: response.profileProgression?.data?.seasonalArtifact?.artifactHash ?? null,
})

/** The identities a slot can be given, in Bungie's order, and how many slots a character has. */
export interface LoadoutCatalog {
  readonly count: number
  readonly names: ReadonlyArray<LoadoutIdentity>
  readonly colors: ReadonlyArray<LoadoutIdentity>
  readonly icons: ReadonlyArray<LoadoutIdentity>
}

const Constants = Schema.Struct({
  loadoutCountPerCharacter: Schema.Number,
  loadoutNameHashes: Schema.Array(Schema.Number),
  loadoutColorHashes: Schema.Array(Schema.Number),
  loadoutIconHashes: Schema.Array(Schema.Number),
})
const NameDefinition = Schema.Struct({ hash: Schema.Number, name: Schema.String })
const ColorDefinition = Schema.Struct({ hash: Schema.Number, colorImagePath: Schema.String })
const IconDefinition = Schema.Struct({ hash: Schema.Number, iconImagePath: Schema.String })
const definitionsOf = <S extends Schema.Top>(definition: S) =>
  Schema.Record(Schema.String, definition)
const ManifestIndex = Schema.Struct({
  Response: Schema.Struct({
    jsonWorldComponentContentPaths: Schema.Record(
      Schema.String,
      Schema.Record(Schema.String, Schema.String),
    ),
  }),
})

export interface LoadoutDefinitions {
  readonly constants: typeof Constants.Type
  readonly names: ReadonlyArray<typeof NameDefinition.Type>
  readonly colors: ReadonlyArray<typeof ColorDefinition.Type>
  readonly icons: ReadonlyArray<typeof IconDefinition.Type>
}

const inOrder = <D extends { readonly hash: number }>(
  hashes: ReadonlyArray<number>,
  definitions: ReadonlyArray<D>,
  identity: (definition: D) => LoadoutIdentity,
) =>
  hashes.flatMap((hash) => {
    const definition = definitions.find((each) => each.hash === hash)
    return definition === undefined ? [] : [identity(definition)]
  })

const image = (path: string) => `https://www.bungie.net${path}`

export const catalogFrom = (definitions: LoadoutDefinitions): LoadoutCatalog => ({
  count: definitions.constants.loadoutCountPerCharacter,
  names: inOrder(
    definitions.constants.loadoutNameHashes,
    definitions.names,
    (name) => new LoadoutIdentity({ hash: name.hash, name: name.name, icon: null }),
  ),
  colors: inOrder(
    definitions.constants.loadoutColorHashes,
    definitions.colors,
    (color) =>
      new LoadoutIdentity({ hash: color.hash, name: "", icon: image(color.colorImagePath) }),
  ),
  icons: inOrder(
    definitions.constants.loadoutIconHashes,
    definitions.icons,
    (icon) => new LoadoutIdentity({ hash: icon.hash, name: "", icon: image(icon.iconImagePath) }),
  ),
})

/**
 * Guardian Ranks unlock slots beyond the manifest's count, so a character's
 * own loadouts decide how many it has when Bungie returns more.
 */
export const slotCount = (catalog: LoadoutCatalog, loadouts: ReadonlyArray<GameLoadout>) =>
  Math.max(catalog.count, loadouts.length)

export const validateSlot = (
  choice: LoadoutSlotChoice,
  catalog: LoadoutCatalog,
  loadouts: ReadonlyArray<GameLoadout>,
): LoadoutSlotInvalid | undefined => {
  const count = slotCount(catalog, loadouts)
  const has = (list: ReadonlyArray<LoadoutIdentity>, hash: number) =>
    list.some((each) => each.hash === hash)
  const reason =
    !Number.isInteger(choice.index) || choice.index < 0 || choice.index >= count
      ? `slot ${choice.index + 1} does not exist; this character has ${count} slots`
      : !has(catalog.names, choice.nameHash)
        ? `${choice.nameHash} is not a loadout name`
        : !has(catalog.colors, choice.colorHash)
          ? `${choice.colorHash} is not a loadout color`
          : !has(catalog.icons, choice.iconHash)
            ? `${choice.iconHash} is not a loadout icon`
            : undefined
  return reason === undefined ? undefined : new LoadoutSlotInvalid({ reason })
}

const identity = (list: ReadonlyArray<LoadoutIdentity>, hash: number) =>
  list.find((each) => each.hash === hash) ?? null

/** What an in-game slot is called now, or null when it is empty. */
export const slotName = (catalog: LoadoutCatalog, loadout: GameLoadout | undefined) =>
  loadout === undefined || isEmptyLoadout(loadout)
    ? null
    : (identity(catalog.names, loadout.nameHash)?.name ?? null)

export const slotsFor = (
  loadouts: ReadonlyArray<GameLoadout>,
  catalog: LoadoutCatalog,
  claims: ReadonlyMap<number, string>,
): LoadoutSlots =>
  new LoadoutSlots({
    slots: Array.from({ length: slotCount(catalog, loadouts) }, (_, index) => {
      const loadout = loadouts[index]
      const empty = loadout === undefined || isEmptyLoadout(loadout)
      return new InGameSlot({
        index,
        empty,
        name: empty ? null : identity(catalog.names, loadout.nameHash),
        color: empty ? null : identity(catalog.colors, loadout.colorHash),
        icon: empty ? null : identity(catalog.icons, loadout.iconHash),
        savedBuildId: claims.get(index) ?? null,
      })
    }),
    names: catalog.names,
    colors: catalog.colors,
    icons: catalog.icons,
  })

export interface LoadoutsService {
  /** Every character's in-game loadouts, cached briefly like the profile. */
  readonly current: Effect.Effect<GameLoadouts, BungieError | BungieNotLinked>
  readonly invalidate: Effect.Effect<void>
  readonly catalog: Effect.Effect<LoadoutCatalog, BungieError>
}

export class Loadouts extends Context.Service<Loadouts, LoadoutsService>()("Loadouts") {}

export const LoadoutsLive = Layer.effect(
  Loadouts,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const bungie = yield* BungieClient
    const profile = yield* ProfileStore
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("X-API-Key", Redacted.value(config.bungie.apiKey)),
      ),
    )
    const transport = (cause: unknown) =>
      new BungieError({ status: "Transport", message: String(cause) })
    const fetchJson = <S extends Schema.Constraint>(url: string, schema: S) =>
      http
        .get(url)
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)), Effect.mapError(transport))

    const load = Effect.gen(function* () {
      const inv = yield* profile.inventory
      const raw = yield* bungie.get(
        `/Destiny2/${inv.membershipType}/Profile/${inv.membershipId}/?components=${LOADOUT_COMPONENTS.join(",")}`,
      )
      const response = yield* Schema.decodeUnknownEffect(LoadoutsResponse)(raw).pipe(
        Effect.catch((cause) =>
          Effect.die(new Error(`unexpected Bungie loadouts response: ${String(cause)}`)),
        ),
      )
      return parseLoadouts(response)
    })
    const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(load, "30 seconds")
    const current = cached.pipe(Effect.tapError(() => invalidate))

    const loadCatalog = Effect.gen(function* () {
      const index = yield* fetchJson(
        "https://www.bungie.net/Platform/Destiny2/Manifest/",
        ManifestIndex,
      )
      const paths = index.Response.jsonWorldComponentContentPaths.en ?? {}
      const table = <S extends Schema.Codec<unknown, unknown, never, never>>(
        name: string,
        definition: S,
      ): Effect.Effect<ReadonlyArray<S["Type"]>, BungieError> => {
        const path = paths[name]
        return path === undefined
          ? Effect.fail(new BungieError({ status: "Manifest", message: `no ${name}` }))
          : fetchJson(image(path), definitionsOf(definition)).pipe(
              Effect.map((definitions): ReadonlyArray<S["Type"]> => Object.values(definitions)),
            )
      }
      const [constants] = yield* table("DestinyLoadoutConstantsDefinition", Constants)
      if (constants === undefined) {
        return yield* new BungieError({ status: "Manifest", message: "no loadout constants" })
      }
      return catalogFrom({
        constants,
        names: yield* table("DestinyLoadoutNameDefinition", NameDefinition),
        colors: yield* table("DestinyLoadoutColorDefinition", ColorDefinition),
        icons: yield* table("DestinyLoadoutIconDefinition", IconDefinition),
      })
    })
    const [cachedCatalog, forgetCatalog] = yield* Effect.cachedInvalidateWithTTL(
      loadCatalog,
      "6 hours",
    )
    const catalog = cachedCatalog.pipe(Effect.tapError(() => forgetCatalog))

    return { current, invalidate, catalog }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
