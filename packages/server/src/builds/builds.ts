import {
  BuildFacets,
  type BuildNotFound,
  BuildReadiness,
  type BungieNotLinked,
  type EquipBuild,
  EquipBuildResult,
  type InGameSlotRef,
  type InGameState,
  type JobNotFound,
  type LoadoutSlotChoice,
  type LoadoutSlotInvalid,
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
} from "@ghost/contract"
import { Context, Effect, Layer, Option } from "effect"
import type { BungieError } from "../bungie/client.ts"
import { type Inventory, isArmor, isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import {
  type GameLoadout,
  isEmptyLoadout,
  Loadouts,
  slotName,
  slotsFor,
  validateSlot,
} from "../bungie/loadouts.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { ChargeEffects } from "../db/charge.ts"
import { BuildsRepo, type StoredBuild } from "../db/builds.ts"
import { JobsRepo } from "../db/jobs.ts"
import { title } from "../items/items.ts"
import { composeBuild } from "../plans/compose.ts"
import type { BuildRecipe } from "../plans/recipe.ts"

type ReadErrors = BungieError | BungieNotLinked
type EquipErrors = BuildNotFound | PlanNotApplicable | LoadoutSlotInvalid | ReadErrors

export interface BuildsService {
  readonly list: Effect.Effect<ReadonlyArray<SavedBuild>>
  readonly save: (input: SaveBuild) => Effect.Effect<SaveBuildResult, JobNotFound | EquipErrors>
  readonly rename: (id: string, name: string) => Effect.Effect<SavedBuild, BuildNotFound>
  readonly remove: (id: string) => Effect.Effect<void, BuildNotFound>
  /** A proposed job that equips the build on the character; nothing moves until the player confirms it. */
  readonly equip: (id: string, input: EquipBuild) => Effect.Effect<EquipBuildResult, EquipErrors>
  readonly slots: (characterId: string) => Effect.Effect<LoadoutSlots, ReadErrors>
}

export class Builds extends Context.Service<Builds, BuildsService>()("Builds") {}

const WEAPON_ORDER = ["kinetic", "energy", "power"]

/** The rows a build leaves on the character: what it equips and what it keeps on. */
const keptRows = (plan: Plan) =>
  plan.rows.filter((row) => row.action === "equip" || row.action === "none")

/** Undefined for a plan that names no character, which a build always does. */
export const buildFacets = (plan: Plan): BuildFacets | undefined => {
  if (plan.loadout === undefined) return undefined
  const kept = keptRows(plan)
  const weapons = kept
    .filter((row) => row.slot !== undefined && isWeapon(row.slot))
    .sort((a, b) => WEAPON_ORDER.indexOf(a.slot ?? "") - WEAPON_ORDER.indexOf(b.slot ?? ""))
  const armor = kept.filter((row) => row.slot !== undefined && isArmor(row.slot))
  return new BuildFacets({
    classType: plan.loadout.classType,
    element: plan.loadout.element,
    subclass: plan.loadout.subclass,
    exoticArmor: armor.find((row) => row.tier === "exotic")?.name ?? null,
    exoticWeapon: weapons.find((row) => row.tier === "exotic")?.name ?? null,
    weaponTypes: weapons.flatMap((row) => (row.typeName === undefined ? [] : [row.typeName])),
  })
}

const inGameState = (plan: Plan, slot: GameLoadout | undefined): InGameState =>
  slot === undefined || isEmptyLoadout(slot)
    ? "cleared"
    : keptRows(plan).every((row) => slot.itemInstanceIds.includes(row.itemInstanceId))
      ? "matches"
      : "changed"

export const buildReadiness = (
  plan: Plan,
  inventory: Inventory,
  inGame: InGameSlotRef | null,
  slot: GameLoadout | undefined,
  artifactHash: number | null,
): BuildReadiness => {
  const owned = new Set(inventory.items.map((item) => item.itemInstanceId))
  return new BuildReadiness({
    missing: keptRows(plan)
      .filter((row) => !owned.has(row.itemInstanceId))
      .map((row) => row.name),
    pastArtifact:
      plan.artifact !== undefined &&
      artifactHash !== null &&
      plan.artifact.artifactHash !== artifactHash,
    inGame: inGame === null ? null : inGameState(plan, slot),
  })
}

/** Highest stat total, then power, then masterworked; the copy most worth equipping. */
const better = (a: OwnedItem, b: OwnedItem) =>
  (b.statTotal ?? 0) - (a.statTotal ?? 0) ||
  (b.power ?? 0) - (a.power ?? 0) ||
  Number(b.masterwork) - Number(a.masterwork)

export interface Substitution {
  readonly recipe: BuildRecipe
  /** Names of the pieces another copy of the same item stands in for. */
  readonly substituted: ReadonlyArray<string>
  /** The saved rows no copy is left for, each unticked and marked. */
  readonly lost: ReadonlyArray<PlanRow>
}

/** Rewrites a saved recipe for the items owned now, swapping each lost piece for the best copy of the same item. */
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
      lost.push(new PlanRow({ ...saved, selected: false, outcome: null, error: "no longer owned" }))
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
  }
}

/** The rows in the recipe's order, the lost ones back where they were. */
const inRecipeOrder = (
  recipe: BuildRecipe,
  composed: ReadonlyArray<PlanRow>,
  lost: ReadonlyArray<PlanRow>,
) => {
  const byId = new Map([...composed, ...lost].map((row) => [row.itemInstanceId, row]))
  return recipe.rows.flatMap((row) => {
    const found = byId.get(row.itemInstanceId)
    return found === undefined ? [] : [found]
  })
}

/** What the record keeps: a plan to propose again, with nothing of its first run on it. */
export const normalizePlan = (plan: Plan): Plan => {
  const { saveTo: _saveTo, ...rest } = plan
  const change = plan.loadout?.change
  return new Plan({
    ...rest,
    status: "proposed",
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

const confirmLabel = (saveTo: LoadoutSaveTo | undefined, name: string) =>
  saveTo === undefined
    ? `EQUIP ${name.toUpperCase()}`
    : `EQUIP & SAVE TO SLOT ${saveTo.index + 1}${saveTo.replaces === null ? "" : ` · REPLACES ${saveTo.replaces.toUpperCase()}`}`

export const BuildsLive = Layer.effect(
  Builds,
  Effect.gen(function* () {
    const builds = yield* BuildsRepo
    const jobs = yield* JobsRepo
    const profile = yield* ProfileStore
    const loadouts = yield* Loadouts
    const composing = yield* Effect.context<Manifest | ProfileStore | ChargeEffects>()

    const present = (stored: ReadonlyArray<StoredBuild>) =>
      Effect.gen(function* () {
        const live = yield* Effect.option(Effect.all([profile.inventory, loadouts.current]))
        return stored.flatMap((build) => {
          const facets = buildFacets(build.plan)
          if (facets === undefined) return []
          const readiness = Option.map(live, ([inventory, game]) =>
            buildReadiness(
              build.plan,
              inventory,
              build.inGame,
              build.inGame === null
                ? undefined
                : game.byCharacter.get(build.inGame.characterId)?.[build.inGame.index],
              game.artifactHash,
            ),
          )
          return [
            new SavedBuild({
              id: build.id,
              name: build.name,
              plan: build.plan,
              facets,
              readiness: Option.getOrNull(readiness),
              inGame: build.inGame,
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
        const build = yield* builds.get(id).pipe(Effect.catchTag("SqlError", Effect.die))
        const inv = yield* profile.inventory
        const target = inv.characters.find((each) => each.characterId === input.characterId)
        if (target === undefined) {
          return yield* new PlanNotApplicable({ reason: "that character is gone" })
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
        const { recipe, substituted, lost } = substitute(retargeted, build.plan, inv)
        const composed = yield* composeBuild(recipe, inv).pipe(
          Effect.provideContext(composing),
          Effect.catchTag("BuildRefusal", (refusal) =>
            Effect.fail(new PlanNotApplicable({ reason: refusal.message })),
          ),
        )
        const saveTo = input.saveTo === undefined ? undefined : yield* chooseSlot(input.saveTo, id)
        const plan = new Plan({
          ...composed.plan,
          subtitle: build.name,
          rows: inRecipeOrder(retargeted, composed.plan.rows, lost),
          confirmLabel: confirmLabel(saveTo, build.name),
          saveTo,
          saveable: true,
        })
        const job = yield* jobs
          .createManual({
            kind: "saved_build",
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
        const job = yield* jobs.get(input.jobId).pipe(Effect.catchTag("SqlError", Effect.die))
        if (job.plan === null || job.plan.kind !== "build") {
          return yield* new PlanNotApplicable({ reason: "this request is not a build" })
        }
        if (buildFacets(job.plan) === undefined) {
          return yield* new PlanNotApplicable({ reason: "this build names no character" })
        }
        const recipe = yield* jobs.recipe(input.jobId).pipe(Effect.orDie)
        if (Option.isNone(recipe)) {
          return yield* new PlanNotApplicable({
            reason: "this build was made before builds could be saved; ask Ghost for it again",
          })
        }
        const existing = yield* builds.byJob(input.jobId).pipe(Effect.orDie)
        const stored = Option.isSome(existing)
          ? yield* builds.rename(existing.value.id, input.name).pipe(Effect.orDie)
          : yield* builds
              .insert({
                jobId: input.jobId,
                name: input.name,
                recipe: recipe.value,
                plan: normalizePlan(job.plan),
              })
              .pipe(Effect.orDie)
        const confirm =
          input.inGame === undefined
            ? null
            : (yield* equip(stored.id, {
                characterId: input.inGame.characterId,
                saveTo: input.inGame,
              })).job
        return new SaveBuildResult({ build: yield* presentOne(stored), confirm })
      })

    const rename = (id: string, name: string) =>
      builds
        .rename(id, name)
        .pipe(Effect.catchTag("SqlError", Effect.die), Effect.flatMap(presentOne))

    const remove = (id: string) => builds.remove(id).pipe(Effect.catchTag("SqlError", Effect.die))

    const slots = (characterId: string) =>
      Effect.gen(function* () {
        const [game, catalog, stored] = yield* Effect.all([
          loadouts.current,
          loadouts.catalog,
          builds.list.pipe(Effect.orDie),
        ])
        const claims = new Map(
          stored.flatMap((build) =>
            build.inGame === null || build.inGame.characterId !== characterId
              ? []
              : [[build.inGame.index, build.id] as const],
          ),
        )
        return slotsFor(game.byCharacter.get(characterId) ?? [], catalog, claims)
      })

    return { list, save, rename, remove, equip, slots }
  }),
)
