import {
  BuildFacets,
  type BuildNotFound,
  BuildReadiness,
  type BungieNotLinked,
  type EquipBuild,
  type GuardianClass,
  EquipBuildResult,
  type EditBuild,
  InGameSlotRef,
  type InGameState,
  type ItemSlot,
  ItemSummary,
  type LinkBuild,
  type JobNotFound,
  type LoadoutSlotChoice,
  LoadoutSlotInvalid,
  LoadoutSaveTo,
  type LoadoutSlots,
  Plan,
  PlanNotApplicable,
  PlanRow,
  type SaveBuild,
  SaveBuildResult,
  SavedBuild,
  SubclassChange,
  SubclassLoadout,
} from '@ghost/contract'
import { Context, Effect, Layer, Option } from 'effect'
import { Artifacts } from '../bungie/artifact.ts'
import type { BungieError } from '../bungie/client.ts'
import {
  type CharacterInfo,
  type Inventory,
  isArmor,
  isEmptyPlug,
  isWeapon,
  type OwnedItem,
  type SlottedPlugs,
  slottedPlugs,
} from '../bungie/inventory.ts'
import {
  type GameLoadout,
  type GameLoadouts,
  isEmptyLoadout,
  type LoadoutItem,
  Loadouts,
  NO_PLUG,
  sameSnapshot,
  type SlotSnapshot,
  slotName,
  slotsFor,
  snapshotOf,
  validateSlot,
} from '../bungie/loadouts.ts'
import { Manifest, type ManifestItem } from '../bungie/manifest.ts'
import { restoreMods, socketsNow } from '../bungie/mods.ts'
import { ProfileStore } from '../bungie/profile.ts'
import { ChargeEffects } from '../db/charge.ts'
import { type BuildLink, BuildsRepo, type SlotKey, type StoredBuild } from '../db/builds.ts'
import { JobsRepo } from '../db/jobs.ts'
import { title } from '../items/items.ts'
import { composeBuild, withPerkIcons } from '../plans/compose.ts'
import type { BuildRecipe, SubclassInput } from '../plans/recipe.ts'
import { Wishlist } from '../wishlist/wishlist.ts'

type ReadErrors = BungieError | BungieNotLinked
type EquipErrors = BuildNotFound | PlanNotApplicable | LoadoutSlotInvalid | ReadErrors

export interface BuildsService {
  readonly list: Effect.Effect<ReadonlyArray<SavedBuild>>
  readonly save: (input: SaveBuild) => Effect.Effect<SaveBuildResult, JobNotFound | EquipErrors>
  readonly edit: (
    id: string,
    input: EditBuild,
  ) => Effect.Effect<SavedBuild, BuildNotFound | PlanNotApplicable | ReadErrors>
  readonly options: (
    id: string,
    slot: ItemSlot,
  ) => Effect.Effect<ReadonlyArray<ItemSummary>, BuildNotFound | ReadErrors>
  readonly link: (id: string, input: LinkBuild) => Effect.Effect<SavedBuild, EquipErrors>
  readonly unlink: (id: string) => Effect.Effect<SavedBuild, BuildNotFound>
  readonly remove: (id: string) => Effect.Effect<void, BuildNotFound>
  readonly equip: (id: string, input: EquipBuild) => Effect.Effect<EquipBuildResult, EquipErrors>
  readonly slots: (characterId: string) => Effect.Effect<LoadoutSlots, ReadErrors>
}

export class Builds extends Context.Service<Builds, BuildsService>()('Builds') {}

const WEAPON_ORDER = ['kinetic', 'energy', 'power']

const keptRows = (plan: Plan) =>
  plan.rows.filter((row) => row.action === 'equip' || row.action === 'none')

export const buildFacets = (plan: Plan): BuildFacets | undefined => {
  if (plan.loadout === undefined) return undefined
  const kept = keptRows(plan)
  const weapons = kept
    .filter((row) => row.slot !== undefined && isWeapon(row.slot))
    .sort((a, b) => WEAPON_ORDER.indexOf(a.slot ?? '') - WEAPON_ORDER.indexOf(b.slot ?? ''))
  const armor = kept.filter((row) => row.slot !== undefined && isArmor(row.slot))
  return new BuildFacets({
    classType: plan.loadout.classType,
    element: plan.loadout.element,
    subclass: plan.loadout.subclass,
    exoticArmor: armor.find((row) => row.tier === 'exotic')?.name ?? null,
    exoticWeapon: weapons.find((row) => row.tier === 'exotic')?.name ?? null,
    weaponTypes: weapons.flatMap((row) => (row.typeName === undefined ? [] : [row.typeName])),
  })
}

const holdsBuild = (plan: Plan, slot: GameLoadout) => {
  const ids = new Set(slot.items.map((item) => item.itemInstanceId))
  return keptRows(plan).every((row) => ids.has(row.itemInstanceId))
}

const LINK_STATES: Readonly<Record<`${boolean}/${boolean}`, InGameState>> = {
  'false/false': 'synced',
  'true/false': 'game_changed',
  'false/true': 'build_changed',
  'true/true': 'diverged',
}

type LinkedBuild = Pick<StoredBuild, 'plan' | 'revision'>

/**
 * How a build compares with its linked slot since the two last agreed, keyed
 * by whether the slot changed in game and whether the build changed in Ghost.
 * A link with no snapshot yet only asks that the slot still holds the build.
 */
export const linkState = (
  build: LinkedBuild,
  link: BuildLink,
  slot: GameLoadout | undefined,
): InGameState => {
  if (slot === undefined || isEmptyLoadout(slot)) return 'cleared'
  const gameChanged =
    link.snapshot === null
      ? !holdsBuild(build.plan, slot)
      : !sameSnapshot(link.snapshot, snapshotOf(slot))
  return LINK_STATES[`${gameChanged}/${link.revision !== build.revision}`]
}

/** The snapshot a link still waiting for one takes: the slot, once it holds every piece the build keeps. */
export const baselineFor = (
  build: LinkedBuild,
  link: BuildLink,
  slot: GameLoadout | undefined,
): SlotSnapshot | undefined =>
  link.snapshot === null &&
  slot !== undefined &&
  !isEmptyLoadout(slot) &&
  holdsBuild(build.plan, slot)
    ? snapshotOf(slot)
    : undefined

export const buildReadiness = (
  build: LinkedBuild & Pick<StoredBuild, 'link'>,
  inventory: Inventory,
  slot: GameLoadout | undefined,
  artifactHash: number | null,
): BuildReadiness => {
  const owned = new Set(inventory.items.map((item) => item.itemInstanceId))
  const { plan, link } = build
  return new BuildReadiness({
    missing: keptRows(plan)
      .filter((row) => !owned.has(row.itemInstanceId))
      .map((row) => row.name),
    pastArtifact:
      plan.artifact !== undefined &&
      artifactHash !== null &&
      plan.artifact.artifactHash !== artifactHash,
    inGame: link === null ? null : linkState(build, link, slot),
  })
}

const better = (a: OwnedItem, b: OwnedItem) =>
  (b.statTotal ?? 0) - (a.statTotal ?? 0) ||
  (b.power ?? 0) - (a.power ?? 0) ||
  Number(b.masterwork) - Number(a.masterwork)

export interface Substitution {
  readonly recipe: BuildRecipe
  readonly substituted: ReadonlyArray<string>
  readonly lost: ReadonlyArray<PlanRow>
  /** The saved rows' order by the ids they have now: a copy's id for a substituted row, the old id for a lost one. */
  readonly order: ReadonlyArray<string>
}

export const substitute = (recipe: BuildRecipe, plan: Plan, inventory: Inventory): Substitution => {
  const owned = new Map(inventory.items.map((item) => [item.itemInstanceId, item]))
  const taken = new Set(recipe.rows.map((row) => row.itemInstanceId))
  const replacement = new Map<string, string>()
  const substituted: Array<string> = []
  const lost: Array<PlanRow> = []
  for (const row of recipe.rows) {
    if (owned.has(row.itemInstanceId)) continue
    const saved = plan.rows.find((each) => each.itemInstanceId === row.itemInstanceId)
    if (saved === undefined) continue
    const copy = inventory.items
      .filter((item) => item.itemHash === saved.itemHash && !taken.has(item.itemInstanceId))
      .sort(better)[0]
    if (copy === undefined) {
      lost.push(new PlanRow({ ...saved, selected: false, outcome: null, error: 'no longer owned' }))
      continue
    }
    taken.add(copy.itemInstanceId)
    replacement.set(row.itemInstanceId, copy.itemInstanceId)
    substituted.push(saved.name)
  }
  const gone = new Set(lost.map((row) => row.itemInstanceId))
  const renamed = (id: string) => replacement.get(id) ?? id
  const featured =
    recipe.featured === undefined || gone.has(recipe.featured.itemInstanceId)
      ? undefined
      : { ...recipe.featured, itemInstanceId: renamed(recipe.featured.itemInstanceId) }
  return {
    recipe: {
      ...recipe,
      rows: recipe.rows
        .filter((row) => !gone.has(row.itemInstanceId))
        .map((row) => ({ ...row, itemInstanceId: renamed(row.itemInstanceId) })),
      mods: recipe.mods
        ?.filter((mod) => !gone.has(mod.itemInstanceId))
        .map((mod) => ({ ...mod, itemInstanceId: renamed(mod.itemInstanceId) })),
      featured,
    },
    substituted,
    lost,
    order: recipe.rows.map((row) => renamed(row.itemInstanceId)),
  }
}

export const inRecipeOrder = (
  order: ReadonlyArray<string>,
  composed: ReadonlyArray<PlanRow>,
  lost: ReadonlyArray<PlanRow>,
) => {
  const byId = new Map([...composed, ...lost].map((row) => [row.itemInstanceId, row]))
  return order.flatMap((id) => {
    const found = byId.get(id)
    return found === undefined ? [] : [found]
  })
}

/** The mods each saved armor piece ended with, keyed by the id the piece has now. */
export const savedMods = (
  plan: Plan,
  rows: ReadonlyArray<{ readonly itemInstanceId: string }>,
  order: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<string>> =>
  new Map(
    rows.flatMap((row, index) => {
      const mods = plan.rows.find((each) => each.itemInstanceId === row.itemInstanceId)?.armorMods
      const now = order[index]
      return mods === undefined || now === undefined
        ? []
        : [[now, mods.map((mod) => mod.name)] as const]
    }),
  )

/**
 * A piece the build kept on (action none) may have come off since; the replay
 * equips it again, or the in-game slot would save whatever is worn instead.
 */
export const replayRows = (
  recipe: BuildRecipe,
  inv: Inventory,
  characterId: string,
): BuildRecipe => {
  const worn = new Set(
    inv.items
      .filter((item) => item.equipped && item.characterId === characterId)
      .map((item) => item.itemInstanceId),
  )
  return {
    ...recipe,
    rows: recipe.rows.map((row) => {
      if (row.action !== 'none' || worn.has(row.itemInstanceId)) return row
      const { meta: _meta, selected: _selected, ...rest } = row
      return { ...rest, action: 'equip', characterId }
    }),
  }
}

export const normalizePlan = (plan: Plan): Plan => {
  const { saveTo: _saveTo, ...rest } = plan
  const change = plan.loadout?.change
  return new Plan({
    ...rest,
    status: 'proposed',
    rows: plan.rows.map((row) => new PlanRow({ ...row, outcome: null, error: null })),
    loadout:
      plan.loadout === undefined
        ? undefined
        : new SubclassLoadout({
            ...plan.loadout,
            change:
              change === undefined
                ? undefined
                : new SubclassChange({ ...change, outcome: null, error: null }),
          }),
  })
}

const keptIds = (plan: Plan) => keptRows(plan).map((row) => row.itemInstanceId)

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((id) => right.has(id))
}

const isGear = (item: OwnedItem) => isWeapon(item.slot) || isArmor(item.slot)

const wearable = (item: OwnedItem, classType: GuardianClass) =>
  item.classType === null || item.classType === classType

export const pickGear = (
  ids: ReadonlyArray<string>,
  inv: Inventory,
  classType: GuardianClass,
): Effect.Effect<ReadonlyArray<OwnedItem>, PlanNotApplicable> => {
  const owned = new Map(inv.items.map((item) => [item.itemInstanceId, item]))
  const gear: Array<OwnedItem> = []
  const refuse = (reason: string) => Effect.fail(new PlanNotApplicable({ reason }))
  for (const id of new Set(ids)) {
    const item = owned.get(id)
    if (item === undefined) return refuse('one of the picked items is no longer in your inventory')
    if (!isGear(item)) return refuse(`${item.name} is not a weapon or armor piece`)
    if (!wearable(item, classType)) {
      return refuse(
        `${item.name} is ${title(item.classType ?? '')} armor; this build is for a ${title(classType)}`,
      )
    }
    const clash = gear.find((each) => each.slot === item.slot)
    if (clash !== undefined) {
      return refuse(`${clash.name} and ${item.name} both go in the ${item.slot} slot`)
    }
    gear.push(item)
  }
  return Effect.succeed(gear)
}

/**
 * The mods each armor piece should end with: its own from the saved plan, or,
 * for a piece swapped in, those of the piece it replaced in the same slot.
 */
export const carriedMods = (
  plan: Plan,
  gear: ReadonlyArray<OwnedItem>,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const kept = keptRows(plan)
  const picked = new Set(gear.map((item) => item.itemInstanceId))
  return new Map(
    gear.flatMap((item) => {
      if (!isArmor(item.slot)) return []
      const source =
        kept.find((row) => row.itemInstanceId === item.itemInstanceId) ??
        kept.find((row) => row.slot === item.slot && !picked.has(row.itemInstanceId))
      return source?.armorMods === undefined
        ? []
        : [[item.itemInstanceId, source.armorMods.map((mod) => mod.name)] as const]
    }),
  )
}

const subclassRequest = (name: string, plugs: SlottedPlugs): typeof SubclassInput.Type => {
  const ability = (kind: (typeof plugs.abilities)[number]['kind']) =>
    plugs.abilities.find((plug) => plug.kind === kind)?.name
  return {
    name,
    super: plugs.super?.name,
    classAbility: ability('class'),
    jump: ability('jump'),
    melee: ability('melee'),
    grenade: ability('grenade'),
    aspects: plugs.aspects.map((plug) => plug.name),
    fragments: plugs.fragments.map((plug) => plug.name),
  }
}

interface Rework {
  readonly name: string
  readonly characterId: string
  readonly rows: BuildRecipe['rows']
  readonly mods: ReadonlyMap<string, ReadonlyArray<string>>
  readonly subclass: typeof SubclassInput.Type | undefined
  readonly purpose: string | undefined
}

const slotOf = (game: GameLoadouts, slot: SlotKey) =>
  game.byCharacter.get(slot.characterId)?.[slot.index]

const confirmLabel = (saveTo: LoadoutSaveTo | undefined, name: string) =>
  saveTo === undefined
    ? `EQUIP ${name.toUpperCase()}`
    : `EQUIP & SAVE TO SLOT ${saveTo.index + 1}${saveTo.replaces === null ? '' : ` · REPLACES ${saveTo.replaces.toUpperCase()}`}`

export const BuildsLive = Layer.effect(
  Builds,
  Effect.gen(function* () {
    const builds = yield* BuildsRepo
    const jobs = yield* JobsRepo
    const profile = yield* ProfileStore
    const loadouts = yield* Loadouts
    const manifest = yield* Manifest
    const composing = yield* Effect.context<
      Manifest | ProfileStore | ChargeEffects | Wishlist | Artifacts
    >()

    const present = (stored: ReadonlyArray<StoredBuild>) =>
      Effect.gen(function* () {
        const live = yield* Effect.option(Effect.all([profile.inventory, loadouts.current]))
        const items = new Map(
          Option.match(live, {
            onNone: () => [],
            onSome: ([inventory]) => inventory.items.map((item) => [item.itemInstanceId, item]),
          }),
        )
        const weapons = stored.flatMap((build) =>
          build.plan.rows.flatMap((row) =>
            row.perks ? (items.get(row.itemInstanceId) ?? []) : [],
          ),
        )
        const defs = yield* manifest
          .lookup(weapons.flatMap((item) => item.plugHashes))
          .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
        if (Option.isSome(live)) {
          const [, game] = live.value
          yield* Effect.forEach(stored, (build) => {
            const baseline =
              build.link === null
                ? undefined
                : baselineFor(build, build.link, slotOf(game, build.link))
            return baseline === undefined
              ? Effect.void
              : builds.adoptBaseline(build.id, baseline).pipe(Effect.orDie)
          })
        }
        return stored.flatMap((build) => {
          const facets = buildFacets(build.plan)
          if (facets === undefined) return []
          const readiness = Option.map(live, ([inventory, game]) =>
            buildReadiness(
              build,
              inventory,
              build.link === null ? undefined : slotOf(game, build.link),
              game.artifactHash,
            ),
          )
          return [
            new SavedBuild({
              id: build.id,
              name: build.name,
              plan: withPerkIcons(build.plan, items, defs),
              facets,
              readiness: Option.getOrNull(readiness),
              inGame:
                build.link === null
                  ? null
                  : new InGameSlotRef({
                      characterId: build.link.characterId,
                      index: build.link.index,
                      savedAt: build.link.savedAt,
                    }),
              jobId: build.jobId,
              createdAt: build.createdAt,
              updatedAt: build.updatedAt,
            }),
          ]
        })
      })

    const presentOne = (build: StoredBuild) =>
      present([build]).pipe(
        Effect.flatMap((shown) =>
          shown[0] === undefined
            ? Effect.die(new Error(`saved build ${build.id} names no character`))
            : Effect.succeed(shown[0]),
        ),
      )

    const list = builds.list.pipe(Effect.orDie, Effect.flatMap(present))

    // The recipe's mods were changes against the pieces as they were when the
    // build was made; once applied they no longer apply. The saved plan holds
    // the mods each piece ended with, so a replay works out the changes anew.
    const modsToRestore = (
      recipe: BuildRecipe,
      wanted: ReadonlyMap<string, ReadonlyArray<string>>,
      inv: Inventory,
    ) =>
      Effect.gen(function* () {
        const owned = new Map(inv.items.map((item) => [item.itemInstanceId, item]))
        const pieces = recipe.rows.flatMap((row) => {
          const item = owned.get(row.itemInstanceId)
          const mods = wanted.get(row.itemInstanceId)
          return item === undefined || mods === undefined ? [] : [{ item, mods }]
        })
        if (pieces.length === 0) return []
        const slotted = pieces.flatMap(({ item }) => item.modSockets.map((s) => s.plugHash))
        const [defs, facts, catalog] = yield* Effect.all([
          manifest
            .lookup(slotted)
            .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map())),
          manifest.plugFacts(slotted),
          manifest.armorMods,
        ])
        return pieces.flatMap(({ item, mods }) =>
          restoreMods({
            item,
            sockets: socketsNow(item, defs, facts),
            catalog,
            wanted: mods,
          }).map((request) => ({ itemInstanceId: item.itemInstanceId, ...request })),
        )
      })

    const chooseSlot = (choice: LoadoutSlotChoice, buildId: string) =>
      Effect.gen(function* () {
        const [game, catalog] = yield* Effect.all([loadouts.current, loadouts.catalog])
        const slots = game.byCharacter.get(choice.characterId) ?? []
        const invalid = validateSlot(choice, catalog, slots)
        if (invalid !== undefined) return yield* invalid
        return new LoadoutSaveTo({
          buildId,
          characterId: choice.characterId,
          index: choice.index,
          nameHash: choice.nameHash,
          colorHash: choice.colorHash,
          iconHash: choice.iconHash,
          replaces: slotName(catalog, slots[choice.index]),
          outcome: null,
          error: null,
        })
      })

    const equip = (id: string, input: EquipBuild) =>
      Effect.gen(function* () {
        const build = yield* builds.get(id).pipe(Effect.catchTag('SqlError', Effect.die))
        const inv = yield* profile.inventory
        const target = inv.characters.find((each) => each.characterId === input.characterId)
        if (target === undefined) {
          return yield* new PlanNotApplicable({ reason: 'that character is gone' })
        }
        const facets = buildFacets(build.plan)
        if (facets !== undefined && facets.classType !== target.classType) {
          return yield* new PlanNotApplicable({
            reason: `this build is for a ${title(facets.classType)}`,
          })
        }
        const retargeted: BuildRecipe = {
          ...build.recipe,
          characterId: target.characterId,
          rows: build.recipe.rows.map((row) =>
            row.characterId === undefined ? row : { ...row, characterId: target.characterId },
          ),
        }
        const substitution = substitute(retargeted, build.plan, inv)
        const { substituted, lost, order } = substitution
        const replayed = replayRows(substitution.recipe, inv, target.characterId)
        const recipe: BuildRecipe = {
          ...replayed,
          mods: yield* modsToRestore(replayed, savedMods(build.plan, retargeted.rows, order), inv),
        }
        const composed = yield* composeBuild(recipe, inv).pipe(
          Effect.provideContext(composing),
          Effect.catchTag('BuildRefusal', (refusal) =>
            Effect.fail(new PlanNotApplicable({ reason: refusal.message })),
          ),
        )
        const saveTo = input.saveTo === undefined ? undefined : yield* chooseSlot(input.saveTo, id)
        const plan = new Plan({
          ...composed.plan,
          subtitle: build.name,
          rows: inRecipeOrder(order, composed.plan.rows, lost),
          confirmLabel: confirmLabel(saveTo, build.name),
          saveTo,
          saveable: true,
        })
        const job = yield* jobs
          .createManual({
            kind: 'saved_build',
            prompt: `Equip ${build.name} on ${title(target.classType)}`,
            characterId: target.characterId,
            plan,
          })
          .pipe(Effect.orDie)
        yield* jobs.setRecipe(job.id, recipe).pipe(Effect.orDie)
        return new EquipBuildResult({ job, substituted })
      })

    const save = (input: SaveBuild) =>
      Effect.gen(function* () {
        const job = yield* jobs.get(input.jobId).pipe(Effect.catchTag('SqlError', Effect.die))
        if (job.plan === null || job.plan.kind !== 'build') {
          return yield* new PlanNotApplicable({ reason: 'this request is not a build' })
        }
        if (buildFacets(job.plan) === undefined) {
          return yield* new PlanNotApplicable({ reason: 'this build names no character' })
        }
        const recipe = yield* jobs.recipe(input.jobId).pipe(Effect.orDie)
        if (Option.isNone(recipe)) {
          return yield* new PlanNotApplicable({
            reason: 'this build was made before builds could be saved; ask Ghost for it again',
          })
        }
        const content = { name: input.name, recipe: recipe.value, plan: normalizePlan(job.plan) }
        const revised =
          job.buildId === null
            ? Option.none<StoredBuild>()
            : yield* builds
                .get(job.buildId)
                .pipe(Effect.catchTag('SqlError', Effect.die), Effect.option)
        const existing = Option.isSome(revised)
          ? revised
          : yield* builds.byJob(input.jobId).pipe(Effect.orDie)
        const stored = Option.isNone(existing)
          ? yield* builds.insert({ jobId: input.jobId, ...content }).pipe(Effect.orDie)
          : existing.value.jobId === input.jobId
            ? yield* builds.rename(existing.value.id, input.name).pipe(Effect.orDie)
            : yield* builds.revise(existing.value.id, content, input.jobId).pipe(Effect.orDie)
        const confirm =
          input.inGame === undefined
            ? null
            : (yield* equip(stored.id, {
                characterId: input.inGame.characterId,
                saveTo: input.inGame,
              })).job
        return new SaveBuildResult({ build: yield* presentOne(stored), confirm })
      })

    const classOf = (build: StoredBuild) => {
      const facets = buildFacets(build.plan)
      return facets === undefined
        ? Effect.fail(new PlanNotApplicable({ reason: 'this build names no character' }))
        : Effect.succeed(facets.classType)
    }

    // Notes and synergy describe the gear they were written for, so they go
    // when the gear does; what the build is for and its targets stay.
    const rework = (build: StoredBuild, change: Rework, inv: Inventory) =>
      Effect.gen(function* () {
        const kept = change.rows
          .filter((row) => row.action === 'equip' || row.action === 'none')
          .map((row) => row.itemInstanceId)
        const {
          note: _note,
          situational: _situational,
          synergy: _synergy,
          shortfall: _shortfall,
          ...lasting
        } = build.recipe
        const { featured } = build.recipe
        const base: BuildRecipe = {
          ...(sameIds(keptIds(build.plan), kept) ? build.recipe : lasting),
          featured:
            featured !== undefined && kept.includes(featured.itemInstanceId) ? featured : undefined,
          subclass: change.subclass,
          purpose: change.purpose,
          characterId: change.characterId,
          rows: change.rows,
        }
        const recipe: BuildRecipe = { ...base, mods: yield* modsToRestore(base, change.mods, inv) }
        const composed = yield* composeBuild(recipe, inv).pipe(
          Effect.provideContext(composing),
          Effect.catchTag('BuildRefusal', (refusal) =>
            Effect.fail(new PlanNotApplicable({ reason: refusal.message })),
          ),
        )
        return yield* builds
          .revise(build.id, { name: change.name, recipe, plan: normalizePlan(composed.plan) })
          .pipe(Effect.catchTag('SqlError', Effect.die))
      })

    const edit = (id: string, input: EditBuild) =>
      Effect.gen(function* () {
        const build = yield* builds.get(id)
        const purpose = input.purpose ?? undefined
        if (sameIds(keptIds(build.plan), input.items)) {
          const stored =
            purpose === build.recipe.purpose
              ? yield* builds.rename(id, input.name)
              : yield* builds.revise(id, {
                  name: input.name,
                  recipe: { ...build.recipe, purpose },
                  plan: new Plan({ ...build.plan, purpose }),
                })
          return yield* presentOne(stored)
        }
        const classType = yield* classOf(build)
        const inv = yield* profile.inventory
        const character =
          inv.characters.find(
            (each) => each.characterId === build.recipe.characterId && each.classType === classType,
          ) ?? inv.characters.find((each) => each.classType === classType)
        if (character === undefined) {
          return yield* new PlanNotApplicable({
            reason: `this build is for a ${title(classType)}, and you have none`,
          })
        }
        const gear = yield* pickGear(input.items, inv, classType)
        const rows = gear.map(
          (item) =>
            build.recipe.rows.find(
              (row) =>
                row.itemInstanceId === item.itemInstanceId &&
                (row.action === 'equip' || row.action === 'none'),
            ) ?? {
              itemInstanceId: item.itemInstanceId,
              action: 'equip' as const,
              characterId: character.characterId,
            },
        )
        const stored = yield* rework(
          build,
          {
            name: input.name,
            characterId: character.characterId,
            rows,
            mods: carriedMods(build.plan, gear),
            subclass: build.recipe.subclass,
            purpose,
          },
          inv,
        )
        return yield* presentOne(stored)
      }).pipe(Effect.catchTag('SqlError', Effect.die))

    const options = (id: string, slot: ItemSlot) =>
      Effect.gen(function* () {
        const build = yield* builds.get(id).pipe(Effect.catchTag('SqlError', Effect.die))
        const classType = buildFacets(build.plan)?.classType
        const inv = yield* profile.inventory
        return inv.items
          .filter(
            (item) => item.slot === slot && (classType === undefined || wearable(item, classType)),
          )
          .sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
          .map((item) => new ItemSummary(item))
      })

    // The slot's subclass plugs and armor mods are what the build should end
    // with; a socket the loadout leaves as it is keeps what the piece holds.
    const fromSlot = (
      build: StoredBuild,
      slot: GameLoadout,
      character: CharacterInfo,
      gear: ReadonlyArray<{ readonly entry: LoadoutItem; readonly item: OwnedItem }>,
    ) =>
      Effect.gen(function* () {
        const subclass = character.subclasses.find((each) =>
          slot.items.some((entry) => entry.itemInstanceId === each.itemInstanceId),
        )
        const subclassPlugs =
          slot.items.find((entry) => entry.itemInstanceId === subclass?.itemInstanceId)
            ?.plugItemHashes ?? []
        const armor = gear.filter(({ item }) => isArmor(item.slot))
        const plugIn = (
          entry: LoadoutItem,
          socket: { readonly index: number; readonly plugHash: number },
        ) => {
          const hash = entry.plugItemHashes[socket.index]
          return hash === undefined || hash === NO_PLUG ? socket.plugHash : hash
        }
        const defs = yield* manifest.lookup([
          ...subclassPlugs,
          ...armor.flatMap(({ entry, item }) =>
            item.modSockets.map((socket) => plugIn(entry, socket)),
          ),
        ])
        return {
          name: build.name,
          characterId: character.characterId,
          rows: gear.map(({ item }) => ({
            itemInstanceId: item.itemInstanceId,
            action: 'equip' as const,
            characterId: character.characterId,
          })),
          mods: new Map(
            armor.map(({ entry, item }) => [
              item.itemInstanceId,
              item.modSockets.flatMap((socket) => {
                const def = defs.get(plugIn(entry, socket))
                return def === undefined || isEmptyPlug(def.name) ? [] : [def.name]
              }),
            ]),
          ),
          subclass:
            subclass === undefined
              ? build.recipe.subclass
              : subclassRequest(subclass.name, slottedPlugs(subclassPlugs, defs)),
          purpose: build.recipe.purpose,
        } satisfies Rework
      })

    const link = (id: string, input: LinkBuild) =>
      Effect.gen(function* () {
        const build = yield* builds.get(id)
        const classType = yield* classOf(build)
        const [inv, game] = yield* Effect.all([profile.inventory, loadouts.current])
        const character = inv.characters.find((each) => each.characterId === input.characterId)
        if (character === undefined) {
          return yield* new PlanNotApplicable({ reason: 'that character is gone' })
        }
        if (character.classType !== classType) {
          return yield* new PlanNotApplicable({ reason: `this build is for a ${title(classType)}` })
        }
        const slot = slotOf(game, input)
        if (slot === undefined || isEmptyLoadout(slot)) {
          return yield* new LoadoutSlotInvalid({
            reason: `slot ${input.index + 1} is empty; save the build into it instead`,
          })
        }
        const snapshot = snapshotOf(slot)
        const owned = new Map(inv.items.map((item) => [item.itemInstanceId, item]))
        const gear = slot.items.flatMap((entry) => {
          const item = owned.get(entry.itemInstanceId)
          return item !== undefined && isGear(item) ? [{ entry, item }] : []
        })
        const linked =
          build.link?.characterId === input.characterId && build.link.index === input.index
            ? build.link
            : null
        const slotMoved = linked?.snapshot != null && !sameSnapshot(linked.snapshot, snapshot)
        const pulled =
          sameIds(
            keptIds(build.plan),
            gear.map(({ item }) => item.itemInstanceId),
          ) && !slotMoved
            ? build
            : yield* rework(build, yield* fromSlot(build, slot, character, gear), inv)
        yield* builds.claimInGameSlot(pulled.id, input, snapshot)
        return yield* presentOne(yield* builds.get(pulled.id))
      }).pipe(Effect.catchTag('SqlError', Effect.die))

    const unlink = (id: string) =>
      builds.unlink(id).pipe(Effect.catchTag('SqlError', Effect.die), Effect.flatMap(presentOne))

    const remove = (id: string) => builds.remove(id).pipe(Effect.catchTag('SqlError', Effect.die))

    const slots = (characterId: string) =>
      Effect.gen(function* () {
        const [game, catalog, stored] = yield* Effect.all([
          loadouts.current,
          loadouts.catalog,
          builds.list.pipe(Effect.orDie),
        ])
        const claims = new Map(
          stored.flatMap((build) =>
            build.link === null || build.link.characterId !== characterId
              ? []
              : [[build.link.index, build.id] as const],
          ),
        )
        return slotsFor(game.byCharacter.get(characterId) ?? [], catalog, claims)
      })

    return { list, save, edit, options, link, unlink, remove, equip, slots }
  }),
)
