import {
  type BungieNotLinked,
  ChargeEffect,
  type DamageType,
  Plan,
  type PlanAction,
  PlanFeatured,
  PlanPerk,
  PlanRow,
  PlanStat,
  type SetBonus,
  Source,
  type StatMod,
  SubclassChange,
  SubclassSwap,
  Synergy,
  type WeaponSlot,
} from "@ghost/contract"
import { Effect, Schema } from "effect"
import type { BungieError } from "../bungie/client.ts"
import {
  type CharacterInfo,
  type Inventory,
  isArmor,
  isWeapon,
  type OwnedItem,
} from "../bungie/inventory.ts"
import { describeLoadout, loadoutPlugHashes, loadoutStatChange } from "../bungie/loadout.ts"
import { Manifest, type ManifestItem, type StatFacts } from "../bungie/manifest.ts"
import {
  armorAfter,
  armorStats,
  buildStats,
  type MissedTarget,
  missedTargets,
  withMasterworkTotals,
} from "../bungie/masterwork.ts"
import {
  describeArmorMods,
  type ModSwap,
  planModSwaps,
  socketsNow,
  swapStatChange,
  withChargeEffects,
} from "../bungie/mods.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { isActive, setBonusesFor } from "../bungie/sets.ts"
import { planSubclass, subclassSockets, unlockedPlugs } from "../bungie/subclass.ts"
import { ChargeEffects } from "../db/charge.ts"
import { title } from "../items/items.ts"
import { judgeWeapon, type StoredRoll } from "../wishlist/parse.ts"
import { Wishlist } from "../wishlist/wishlist.ts"
import type { BuildRecipe, SourceInput, SubclassInput } from "./recipe.ts"

/** Why a plan cannot be made, worded for the agent to fix and call present_plan again. */
export class BuildRefusal extends Schema.TaggedError<BuildRefusal>()("BuildRefusal", {
  message: Schema.String,
}) {}

/**
 * The agent reads these, so failures come back as text it can relay instead
 * of a tool error it cannot explain.
 */
export const explain = (error: BungieError | BungieNotLinked | { readonly message: string }) =>
  "_tag" in error && error._tag === "BungieNotLinked"
    ? "Error: the Bungie account is not linked yet. Tell the player to sign in with Bungie in the app."
    : `Error: ${"message" in error ? error.message : String(error)}`

export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

export const setBonusLine = (bonus: SetBonus) =>
  `${bonus.name} (${bonus.set}, ${bonus.required} pieces, wearing ${bonus.worn}): ${oneLine(bonus.description)}`

export const toSource = (s: typeof SourceInput.Type) =>
  new Source({ label: s.label, url: s.url ?? null, asOf: s.asOf ?? null })

const ELEMENTS: ReadonlySet<DamageType> = new Set(["arc", "solar", "void", "stasis", "strand"])

type BuildWeapon = Pick<OwnedItem, "name" | "typeName" | "damageType">

const weaponLine = (weapon: BuildWeapon, element: DamageType | undefined) =>
  `${weapon.name} (${weapon.typeName}, ${weapon.damageType}${
    element !== undefined &&
    ELEMENTS.has(element) &&
    ELEMENTS.has(weapon.damageType) &&
    weapon.damageType !== element
      ? `, not ${element} like the subclass`
      : ""
  })`

/** The parts of a build whose synergy the agent has not written yet, each saying what to write. */
export const synergyMissing = ({
  exotic,
  setBonuses,
  modded,
  weapons,
  element,
  synergy,
}: {
  readonly exotic: Pick<OwnedItem, "name" | "exoticPerk"> | undefined
  readonly setBonuses: ReadonlyArray<SetBonus>
  readonly modded: boolean
  readonly weapons: ReadonlyArray<BuildWeapon>
  /** The build's subclass element, which the weapons are checked against. */
  readonly element: DamageType | undefined
  readonly synergy: Schema.Struct.Type<typeof Synergy.fields> | undefined
}): ReadonlyArray<string> => {
  const active = setBonuses.filter(isActive)
  return [
    exotic !== undefined && !synergy?.exotic?.trim()
      ? `exotic, on what ${exotic.name}${exotic.exoticPerk === null ? "" : ` (${exotic.exoticPerk})`} does for this subclass and its loop`
      : null,
    active.length > 0 && !synergy?.setBonuses?.trim()
      ? `setBonuses, on how the active set bonuses fit: ${active.map(setBonusLine).join(" / ")}`
      : null,
    modded && !synergy?.mods?.trim() ? "mods, on how the armor mods back the loop" : null,
    weapons.length > 0 && !synergy?.weapons?.trim()
      ? `weapons, on how the three weapons feed the loop: ${weapons.map((weapon) => weaponLine(weapon, element)).join(", ")}`
      : null,
  ].filter((part) => part !== null)
}

const WEAPON_SLOTS: ReadonlyArray<WeaponSlot> = ["kinetic", "energy", "power"]

/** How a build's weapon rows break the one-weapon-per-slot rule; empty when they keep it. */
const weaponSlotProblems = (weapons: ReadonlyArray<Pick<OwnedItem, "name" | "slot">>) =>
  WEAPON_SLOTS.flatMap((slot) => {
    const held = weapons.filter((weapon) => weapon.slot === slot)
    if (held.length === 1) return []
    return held.length === 0
      ? [`no ${slot} weapon`]
      : [`${held.length} ${slot} weapons (${held.map((weapon) => weapon.name).join(", ")})`]
  })

const describeMiss = (
  miss: MissedTarget,
  fragments: ReadonlyArray<{ readonly name: string; readonly mods: ReadonlyArray<StatMod> }>,
) => {
  const lowering = fragments.flatMap((fragment) =>
    fragment.mods
      .filter((mod) => mod.label === miss.label && mod.delta < 0)
      .map((mod) => `${fragment.name} ${mod.delta}`),
  )
  return `${miss.label} ${miss.value}, asked ${miss.requested}${lowering.length > 0 ? ` (lowered by ${lowering.join(", ")})` : ""}`
}

const DEFAULT_META: Record<PlanAction, (item: OwnedItem, className: string) => string> = {
  to_vault: (i) => `${i.typeName} → vault`,
  to_character: (i, c) => `${i.typeName} → ${c}`,
  pull_postmaster: (i, c) => `${i.typeName} · postmaster → ${c}`,
  equip: (i, c) => `${i.typeName} · equip on ${c}`,
  tag_junk: (i) => `${i.typeName} · junk`,
  none: (i) => i.typeName,
}

/** Each subclass the character owns with every plug it has unlocked for each socket. */
export const subclassChoices = (character: CharacterInfo) =>
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const manifest = yield* Manifest
    const sets = yield* profile.plugSets
    return yield* Effect.forEach(
      character.subclasses,
      (subclass) =>
        Effect.gen(function* () {
          const plugSets = yield* manifest.subclassPlugSets(subclass.itemHash)
          const unlocked = (set: number) => unlockedPlugs(sets, character.characterId, set)
          const defs = yield* manifest.lookup([
            ...subclass.sockets.map((socket) => socket.plugHash),
            ...plugSets.flatMap((set) => (set === null ? [] : unlocked(set))),
          ])
          const sockets = subclassSockets({ subclass, plugSets, unlocked, defs })
          const plugs = yield* manifest.plugFacts([
            ...new Set(
              sockets
                .filter((socket) => socket.part === "aspect" || socket.part === "fragment")
                .flatMap((socket) => [socket.current, ...socket.options.map((o) => o.hash)]),
            ),
          ])
          return { subclass, defs, sockets, plugs }
        }),
      { concurrency: 4 },
    )
  })

export type SubclassChoice = Effect.Success<ReturnType<typeof subclassChoices>>[number]

export const findSubclass = (choices: ReadonlyArray<SubclassChoice>, wanted: string) =>
  choices.find(
    ({ subclass }) =>
      subclass.name.toLowerCase() === wanted.trim().toLowerCase() ||
      subclass.element === wanted.trim().toLowerCase(),
  )

export const unknownSubclass = (choices: ReadonlyArray<SubclassChoice>, wanted: string) =>
  `Error: "${wanted}" is not a subclass this character owns; pick from ${choices.map((c) => c.subclass.name).join(", ")}.`

const buildSubclass = (
  character: CharacterInfo,
  request: typeof SubclassInput.Type,
  facts: StatFacts,
) =>
  Effect.gen(function* () {
    const manifest = yield* Manifest
    const choices = yield* subclassChoices(character)
    const choice = findSubclass(choices, request.name)
    if (choice === undefined) return { error: unknownSubclass(choices, request.name) }
    const planned = planSubclass({
      name: choice.subclass.name,
      sockets: choice.sockets,
      request,
      defs: choice.defs,
      fragmentSlots: (hash) => choice.plugs.get(hash)?.fragmentSlots ?? 0,
    })
    if ("errors" in planned) {
      return {
        error: `Error: ${planned.errors.join(". ")}. Check list_subclasses and call present_plan again.`,
      }
    }
    const equipped = character.subclasses.find((subclass) => subclass.equipped)
    const switching = !choice.subclass.equipped
    const change =
      switching || planned.swaps.length > 0
        ? new SubclassChange({
            itemInstanceId: choice.subclass.itemInstanceId,
            itemHash: choice.subclass.itemHash,
            characterId: character.characterId,
            replaces: switching ? (equipped?.name ?? null) : null,
            previousItemId: switching ? (equipped?.itemInstanceId ?? null) : null,
            swaps: planned.swaps.map(
              (swap) =>
                new SubclassSwap({
                  name: swap.plug.name,
                  socketIndex: swap.socketIndex,
                  plugHash: swap.plug.hash,
                  previousPlugHash: swap.previousPlugHash,
                }),
            ),
            selected: true,
            outcome: null,
            error: null,
          })
        : undefined
    const worn = loadoutPlugHashes(character)
    const plugs = new Map([...(yield* manifest.plugFacts(worn)), ...choice.plugs])
    return {
      loadout: describeLoadout({
        character: {
          classType: character.classType,
          subclass: choice.subclass.name,
          subclassIcon: choice.subclass.icon,
          element: choice.subclass.element,
          loadout: planned.loadout,
        },
        plugs,
        facts,
        swapped: new Map(
          planned.swaps.map((swap) => [swap.plug.hash, swap.previous?.name ?? null]),
        ),
        change,
      }),
      statChange: loadoutStatChange({
        from: worn,
        to: loadoutPlugHashes({ loadout: planned.loadout }),
        plugs,
        classType: character.classType,
      }),
      summary: [
        switching ? `equips ${choice.subclass.name}` : null,
        planned.swaps.length > 0 ? `${planned.swaps.length} subclass plug changes` : null,
      ].filter((part) => part !== null),
    }
  })

export interface ComposedBuild {
  /** Its set bonuses are not judged against the build's purpose yet. */
  readonly plan: Plan
  /** The armor the character wears once the plan runs. */
  readonly armor: ReadonlyArray<OwnedItem>
  /** The weapons a build lists, in row order; empty for other plans. */
  readonly weapons: ReadonlyArray<OwnedItem>
  readonly misses: ReadonlyArray<MissedTarget>
  readonly modSwaps: number
  /** What changes on the subclass; null when the recipe picks none. */
  readonly subclassChanges: ReadonlyArray<string> | null
}

const refuse = (message: string) => new BuildRefusal({ message })

/** Each weapon's trait perks and wishlist score; a weapon reads as unscored when the wishlist is out of reach. */
const judgeWeapons = (weapons: ReadonlyArray<OwnedItem>) =>
  Effect.gen(function* () {
    if (weapons.length === 0) return new Map<string, ReturnType<typeof judgeWeapon>>()
    const manifest = yield* Manifest
    const wishlist = yield* Wishlist
    const rolls = yield* wishlist
      .rollsFor(weapons.map((weapon) => weapon.itemHash))
      .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ReadonlyArray<StoredRoll>> => new Map()))
    const defs = yield* manifest
      .lookup([
        ...weapons.flatMap((weapon) => weapon.plugHashes),
        ...[...rolls.values()].flat().flatMap((roll) => roll.perkHashes),
      ])
      .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
    const nameOf = (hash: number) => defs.get(hash)?.name
    return new Map(
      weapons.map((weapon) => [
        weapon.itemInstanceId,
        judgeWeapon(weapon, rolls.get(weapon.itemHash) ?? [], nameOf),
      ]),
    )
  })

/** Make the plan a recipe describes from what the player owns now. */
export const composeBuild = (
  recipe: BuildRecipe,
  inv: Inventory,
): Effect.Effect<ComposedBuild, BuildRefusal, Manifest | ProfileStore | ChargeEffects | Wishlist> =>
  Effect.gen(function* () {
    const manifest = yield* Manifest
    const chargeEffects = yield* ChargeEffects
    const owned = new Map(inv.items.map((i) => [i.itemInstanceId, i]))
    const classOf = new Map(inv.characters.map((c) => [c.characterId, c.classType]))
    const ids = recipe.rows.map((r) => r.itemInstanceId)
    if (recipe.featured !== undefined) ids.push(recipe.featured.itemInstanceId)
    const unknown = ids.filter((id) => !owned.has(id))
    if (unknown.length > 0) {
      return yield* refuse(
        `Error: unknown item ids ${unknown.join(", ")}. Use ids from search_items or get_characters.`,
      )
    }
    const pieces = recipe.rows.flatMap((row) => {
      const item = owned.get(row.itemInstanceId)
      return item === undefined ? [] : [{ row, item }]
    })
    const badCharacter = recipe.rows.find(
      (r) => r.characterId !== undefined && !classOf.has(r.characterId),
    )
    if (badCharacter !== undefined) {
      return yield* refuse(
        `Error: unknown characterId ${badCharacter.characterId}. Use ids from get_characters.`,
      )
    }
    const fallback = recipe.characterId
    const facts = yield* manifest.statFacts
    const slotted = recipe.rows.flatMap((r) =>
      (owned.get(r.itemInstanceId)?.modSockets ?? []).map((socket) => socket.plugHash),
    )
    const modDefs = yield* manifest
      .lookup(slotted)
      .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
    const modFacts = yield* manifest.plugFacts(slotted)
    const wanted = recipe.mods ?? []
    const stray = wanted.filter(
      (m) => !recipe.rows.some((r) => r.itemInstanceId === m.itemInstanceId),
    )
    if (stray.length > 0) {
      return yield* refuse(
        `Error: mods name pieces that are not rows of the plan: ${stray.map((m) => m.itemInstanceId).join(", ")}. List each piece as a row (action none if it stays on).`,
      )
    }
    const researched = recipe.chargeEffects ?? []
    const catalog = wanted.length > 0 || researched.length > 0 ? yield* manifest.armorMods : []
    const notCharged = researched.filter(
      (r) =>
        !catalog.some((entry) => entry.charged && entry.name.toLowerCase() === r.mod.toLowerCase()),
    )
    if (notCharged.length > 0) {
      return yield* refuse(
        `Error: chargeEffects names mods that are not armor charge mods: ${notCharged.map((r) => r.mod).join(", ")}. Use names from list_armor_mods with charged true.`,
      )
    }
    const swapsFor = new Map<string, ReadonlyArray<ModSwap>>()
    const refused: Array<string> = []
    for (const { row: r, item } of pieces) {
      const requests = wanted.filter((m) => m.itemInstanceId === r.itemInstanceId)
      if (requests.length === 0) continue
      const planned = planModSwaps({
        item,
        sockets: socketsNow(item, modDefs, modFacts),
        catalog,
        requests,
      })
      refused.push(...planned.errors)
      swapsFor.set(r.itemInstanceId, planned.swaps)
    }
    if (refused.length > 0) {
      return yield* refuse(
        `Error: ${refused.join(". ")}. Fix the mods and call present_plan again.`,
      )
    }
    yield* chargeEffects
      .record(
        researched.map((r) => ({
          mod: r.mod,
          effect: new ChargeEffect({ effect: r.effect, source: toSource(r.source) }),
        })),
      )
      .pipe(Effect.orDie)
    const weapons =
      recipe.kind === "build"
        ? pieces.filter(({ item }) => isWeapon(item.slot)).map(({ item }) => item)
        : []
    const judged = yield* judgeWeapons(weapons)
    const drafted = pieces.map(({ row: r, item }) => {
      const characterId =
        r.action === "pull_postmaster"
          ? item.characterId
          : r.action === "to_character" || r.action === "equip"
            ? (r.characterId ?? fallback)
            : (r.characterId ?? null)
      const className = title(classOf.get(characterId ?? "") ?? "character")
      const arrives = r.action === "equip" || r.action === "to_character"
      const from = !arrives
        ? undefined
        : item.location !== "character"
          ? title(item.location)
          : item.characterId !== characterId
            ? classOf.get(item.characterId ?? "")
            : undefined
      const mods =
        item.armorStats === null
          ? undefined
          : describeArmorMods({
              sockets: socketsNow(item, modDefs, modFacts),
              swaps: swapsFor.get(item.itemInstanceId) ?? [],
              facts,
            })
      return new PlanRow({
        itemInstanceId: item.itemInstanceId,
        itemHash: item.itemHash,
        name: item.name,
        icon: item.icon,
        tier: item.tier,
        meta: r.meta ?? DEFAULT_META[r.action](item, className),
        power: item.power,
        score: r.score ?? judged.get(item.itemInstanceId)?.score ?? null,
        action: r.action,
        characterId,
        selected:
          r.action === "none" && (swapsFor.get(item.itemInstanceId)?.length ?? 0) === 0
            ? false
            : (r.selected ?? true),
        outcome: null,
        error: null,
        stats: item.armorStats === null ? undefined : armorStats(item),
        slot: item.slot,
        masterwork: item.masterwork,
        damageType: item.damageType,
        gearTier: item.gearTier ?? null,
        armorMods: mods?.armorMods,
        freeModSlots: mods?.freeModSlots,
        energy:
          item.energy === null || mods === undefined
            ? undefined
            : { used: mods.energyUsed, capacity: item.energy.capacity },
        origin: from === undefined ? undefined : title(from),
        perks: judged.get(item.itemInstanceId)?.perks.map((perk) => new PlanPerk(perk)),
        typeName: judged.has(item.itemInstanceId) ? item.typeName : undefined,
      })
    })
    const effects = yield* chargeEffects
      .forMods(
        drafted.flatMap((row) =>
          (row.armorMods ?? []).filter((mod) => mod.charged).map((mod) => mod.name),
        ),
      )
      .pipe(Effect.orDie)
    const rows = drafted.map((row) =>
      row.armorMods === undefined
        ? row
        : new PlanRow({ ...row, armorMods: withChargeEffects(row.armorMods, effects) }),
    )
    const equipping = rows.filter((row) => row.action === "equip")
    const builtFor = inv.characters.find(
      (c) => c.characterId === (equipping[0]?.characterId ?? fallback),
    )
    const chosen =
      recipe.kind === "build" && builtFor !== undefined && recipe.subclass !== undefined
        ? yield* buildSubclass(builtFor, recipe.subclass, facts).pipe(
            Effect.catch((error) => Effect.succeed({ error: explain(error) })),
          )
        : null
    if (chosen !== null && "error" in chosen) return yield* refuse(chosen.error)
    const loadout =
      chosen !== null
        ? chosen.loadout
        : recipe.kind === "build" && builtFor !== undefined
          ? describeLoadout({
              character: builtFor,
              plugs: yield* manifest.plugFacts(loadoutPlugHashes(builtFor)),
              facts,
            })
          : undefined
    const modChange: Record<string, number> = {}
    for (const [stat, delta] of [
      ...Object.entries(swapStatChange([...swapsFor.values()].flat())),
      ...Object.entries(chosen?.statChange ?? {}),
    ])
      modChange[stat] = (modChange[stat] ?? 0) + delta
    const worn =
      builtFor === undefined
        ? []
        : inv.items.filter(
            (i) => i.equipped && i.characterId === builtFor.characterId && isArmor(i.slot),
          )
    const incoming = pieces.filter(({ row }) => row.action === "equip").map(({ item }) => item)
    const planStats =
      recipe.kind === "build" && builtFor !== undefined
        ? buildStats({
            character: builtFor,
            worn,
            incoming,
            targets: (recipe.stats ?? []).filter((s) => s.target).map((s) => s.label),
            facts,
            modChange,
          })
        : withMasterworkTotals(
            (recipe.stats ?? []).map((s) => new PlanStat(s)),
            pieces.map(({ item }) => item),
          )
    const goals = (recipe.stats ?? []).filter((s) => s.target)
    const misses = recipe.kind === "build" ? missedTargets(planStats, goals) : []
    const armor =
      recipe.kind === "build" && builtFor !== undefined ? armorAfter(worn, incoming).final : []
    const setBonuses = setBonusesFor(
      armor.length > 0 ? yield* manifest.armorSets : [],
      armor.map((item) => item.itemHash),
    )
    const note =
      misses.length > 0 && recipe.shortfall !== undefined
        ? [recipe.shortfall, recipe.note].filter((part) => part !== undefined).join(" ")
        : (recipe.note ?? null)
    const plan = new Plan({
      kind: recipe.kind,
      title: recipe.title,
      subtitle: recipe.subtitle ?? null,
      stats: planStats,
      featured:
        recipe.featured === undefined
          ? null
          : new PlanFeatured({
              itemInstanceId: recipe.featured.itemInstanceId,
              perks: recipe.featured.perks.map((p) => new PlanPerk(p)),
              stats: recipe.featured.stats.map((s) => new PlanStat({ ...s, target: false })),
            }),
      loadout,
      rows,
      note,
      situational: recipe.situational,
      setBonuses: setBonuses.length > 0 ? setBonuses : undefined,
      synergy:
        recipe.kind === "build" && recipe.synergy !== undefined
          ? new Synergy(recipe.synergy)
          : undefined,
      confirmLabel: recipe.confirmLabel,
      status: "proposed",
      purpose: recipe.kind === "build" ? recipe.purpose : undefined,
    })
    return {
      plan,
      armor,
      weapons,
      misses,
      modSwaps: [...swapsFor.values()].flat().length,
      subclassChanges: chosen === null ? null : chosen.summary,
    }
  })

/** The first rule a composed plan breaks, or undefined when it keeps them all. */
export const buildRules = (recipe: BuildRecipe, build: ComposedBuild): BuildRefusal | undefined => {
  if (build.misses.length > 0 && recipe.shortfall === undefined) {
    return refuse(
      `Error: the build misses stat goals: ${build.misses.map((miss) => describeMiss(miss, build.plan.loadout?.fragments ?? [])).join("; ")}. Raise them with other armor pieces, stat mods, or fragments that do not lower them, then call present_plan again. If the owned gear truly cannot reach a goal, call again with shortfall saying why in one sentence.`,
    )
  }
  if (recipe.kind === "build" && !recipe.purpose?.trim()) {
    return refuse(
      "Error: a build needs purpose: what it does, in plain words, so Jev can judge its set bonuses. Call present_plan again with purpose.",
    )
  }
  if (recipe.kind === "build") {
    const slotProblems = weaponSlotProblems(build.weapons)
    if (slotProblems.length > 0) {
      return refuse(
        `Error: a build lists exactly one weapon for each of kinetic, energy and power, with action none for one that stays equipped; this one has ${slotProblems.join(", ")}. Call present_plan again with all three.`,
      )
    }
    const exotics = build.weapons.filter((weapon) => weapon.tier === "exotic")
    if (exotics.length > 1) {
      return refuse(
        `Error: a build can equip only one exotic weapon; this one has ${exotics.map((weapon) => weapon.name).join(" and ")}. Keep the one the loop needs, swap the others for legendaries, and call present_plan again.`,
      )
    }
  }
  const unwritten = synergyMissing({
    exotic: build.armor.find((item) => item.tier === "exotic"),
    setBonuses: build.plan.setBonuses ?? [],
    modded: build.plan.rows.some(
      (row) =>
        build.armor.some((item) => item.itemInstanceId === row.itemInstanceId) &&
        (row.armorMods ?? []).length > 0,
    ),
    weapons: build.weapons,
    element: build.plan.loadout?.element,
    synergy: recipe.synergy,
  })
  if (unwritten.length > 0) {
    return refuse(
      `Error: the build needs synergy, one or two sentences per part on how it feeds the rest of the build: ${unwritten.join("; ")}. Call present_plan again with synergy.`,
    )
  }
  return undefined
}
