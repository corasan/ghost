import {
  DamageType,
  GuardianClass,
  ItemLocation,
  ItemSlot,
  ItemTier,
  Plan,
  OFF_BUILD_FIT,
  SetBonus,
} from "@ghost/contract"
import { Effect, Option, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { CurrentJob } from "../agent/current-job.ts"
import { Jev } from "../agent/jev.ts"
import {
  type ArmorStats,
  type Inventory,
  isArmor,
  isWeapon,
  type OwnedItem,
  type OwnedSubclass,
  pickCharacter,
  STAT,
  type SubclassPart,
  type SubclassPlug,
} from "../bungie/inventory.ts"
import {
  type ArmorModEntry,
  type ArmorSet,
  Manifest,
  type ManifestItem,
  type PlugFacts,
} from "../bungie/manifest.ts"
import { ARMOR_STATS } from "../bungie/masterwork.ts"
import { plugStatMods } from "../bungie/loadout.ts"
import { socketsNow } from "../bungie/mods.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { isActive, setBonusesFor } from "../bungie/sets.ts"
import type { SubclassSocket } from "../bungie/subclass.ts"
import { CreatorNotes } from "../creators/creators.ts"
import { NOTE_MAX_AGE_DAYS } from "../creators/parse.ts"
import { ChargeEffects } from "../db/charge.ts"
import { JobsRepo } from "../db/jobs.ts"
import {
  buildRules,
  composeBuild,
  explain,
  findSubclass,
  oneLine,
  setBonusLine,
  type SubclassChoice,
  subclassChoices,
  toSource,
  unknownSubclass,
} from "../plans/compose.ts"
import { type BuildRecipe, PlanInput, SourceInput } from "../plans/recipe.ts"
import { checkRoll, perkMatcher, type RollMatch, recommendations } from "../wishlist/parse.ts"
import { Wishlist, WISHLIST_URL } from "../wishlist/wishlist.ts"

// These are the tools Claude sees. They read the cached inventory and the
// fetched reference data (manifest, community wishlist); none of them moves
// an item. Changes are proposed with present_plan and only run when the
// player confirms in the app.

const Json = Schema.String

const GetCharacters = Tool.make("get_characters", {
  description:
    "The player's characters: class, light, subclass, element, stats, equipped items and postmaster contents, plus vault usage.",
  success: Json,
})

const SearchItems = Tool.make("search_items", {
  description:
    "Search owned items (vault, characters, postmaster). All filters are optional and combine. text matches name, type and perk names. Returns compact JSON rows; item ids are what present_plan and check_rolls take. With purpose, the matches are ranked against it and you get the best few per slot, each with a relevance from 0 to 1, and limit is the count per slot (default 6, max 20). If the result says ranking unavailable, the list is unranked; judge the rows yourself.",
  parameters: Schema.Struct({
    purpose: Schema.optional(
      Schema.String.annotate({
        description:
          "What the player is trying to do with these items, in plain words, for example 'Void Titan build prioritizing Health and grenade uptime' or 'best hand cannon for Trials PvP'. Pass it whenever you are shopping for build gear or picking the best copy of a weapon; leave it out to list everything that matches.",
      }),
    ),
    text: Schema.optional(Schema.String),
    category: Schema.optional(Schema.Literals(["weapon", "armor"])),
    slot: Schema.optional(ItemSlot),
    tier: Schema.optional(ItemTier),
    location: Schema.optional(ItemLocation),
    classType: Schema.optional(GuardianClass),
    damageType: Schema.optional(DamageType),
    duplicatesOnly: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Number),
  }),
  success: Json,
})

const ListSubclasses = Tool.make("list_subclasses", {
  description:
    "The subclasses a character owns and what the player has unlocked for each. Without subclass: each one's name, element and what is slotted now. With subclass (a name or an element): every super, class ability, jump, melee and grenade it can take, its aspects with the fragment slots each brings and effect text, and its fragments with stat changes and effect text. Use these names exactly in present_plan subclass. With subclass and purpose, every option is still listed, each with a relevance from 0 to 1 and sorted by it within its group, but only the most relevant options and what is slotted keep their effect text; read any other option's effect with describe_plugs. If the result says ranking unavailable, nothing is ranked.",
  parameters: Schema.Struct({
    characterId: Schema.optional(Schema.String),
    subclass: Schema.optional(Schema.String),
    purpose: Schema.optional(
      Schema.String.annotate({
        description:
          "What the build does, in plain words: subclass and element, activity, stat goals and playstyle, for example 'Void Sentinel Titan build, 100 Health and 100 Class, overshields and Devour'. Pass it when choosing a build's subclass plugs.",
      }),
    ),
  }),
  success: Json,
})

const PresentPlan = Tool.make("present_plan", {
  description:
    "Show the player a plan to confirm. Nothing moves until they tap the confirm button; the server then runs the selected rows. Call it once per request, after deciding. Row actions: to_vault, to_character, pull_postmaster, equip, tag_junk, or none (shown for comparison only). For a build, list the armor piece for every slot, including pieces that stay equipped (action none). The app works out the build's six stat totals itself from the pieces you equip, before and after, and what masterworking would add, so do not do that arithmetic or repeat those numbers in your reply. For a build, also pick the subclass in subclass: its name (from list_subclasses) and the super, class ability, jump, melee, grenade, aspects and fragments you want, by the names list_subclasses gives. Anything you leave out stays as that subclass has it. Name the fragments the build needs; they go into empty slots first, then replace from the last slot back, and slots you leave spare keep their fragment. The aspects' fragment slots cap the fragments. The server checks the picks and tells you what to fix; on confirm it equips the subclass and slots the plugs, and the build's stats count the chosen fragments. Leave subclass out only when the equipped subclass and its plugs already fit. For a build, also recommend armor mods in mods: one entry per mod to put in, naming the piece (it must be a row) and the mod exactly as list_armor_mods gives it, with replaces when the piece has no free socket of that kind. Only list mods that change; what is already slotted stays. The server checks sockets and energy and tells you what to fix. Every armor charge mod the build will run (charged true in get_armor_mods or list_armor_mods, already slotted or swapped in) needs its numbers: if it has no chargeEffect yet, look up what it adds while charged and how extra copies stack, and pass it in chargeEffects with the source, for example '+10% Arc weapon damage; 17% with two copies, 22% with three'. For a build, also write situational: one to three sentences on what the build's conditional bonuses (armor charge mods, and fragments or aspects that only work under a condition) add together once they are up, how the player keeps them up, and what they lose when they drop. For a build, also write synergy, one or two sentences per part on how it feeds the rest of the build: exotic, what the exotic armor's perk does for this subclass and its loop; setBonuses, how the set bonuses the armor turns on (get_armor_mods lists them) fit the loop, plus any bonus one piece away worth chasing; mods, how the armor mods back the loop. Leave out a part the build lacks; the server refuses a build that has a part without its synergy. For a build, also pass purpose; the server judges the set bonuses against it and tells you when one the armor turns on fits the build poorly. Prefer armor whose set bonuses fit the build. For a build, pass stats only for the stat goals the player names: one entry each, label Health, Melee, Grenade, Super, Class or Weapons (Resilience is Health, Recovery is Class), target true, and value the number they asked for. The server refuses a build whose totals, after armor, mods and fragments, fall short of a goal; if the owned gear truly cannot reach it, pass shortfall with one sentence on why.",
  parameters: PlanInput,
  success: Json,
})

const CheckRolls = Tool.make("check_rolls", {
  description:
    "Judge owned weapon rolls against the DIM community wishlist (curated, fetched data). For each item: its perks, wishlist rolls it fully matches (with curator notes, PvE/PvP tags, section title, url and date), the closest partial matches, a trash flag and a suggested 0-100 score with its basis.",
  parameters: Schema.Struct({ itemInstanceIds: Schema.Array(Schema.String) }),
  success: Json,
})

const RollRecommendations = Tool.make("roll_recommendations", {
  description:
    "Recommended perks for a weapon (by item hash) from the DIM community wishlist, grouped by curator note, with PvE/PvP tags, source section and date.",
  parameters: Schema.Struct({ itemHash: Schema.Number }),
  success: Json,
})

const DescribePlugs = Tool.make("describe_plugs", {
  description:
    "What perks, mods, fragments and aspects do, from the current patch's Bungie manifest. Pass names and/or hashes.",
  parameters: Schema.Struct({
    names: Schema.optional(Schema.Array(Schema.String)),
    hashes: Schema.optional(Schema.Array(Schema.Number)),
  }),
  success: Json,
})

const ModSlot = Schema.Literals(["general", "helmet", "arms", "chest", "legs", "class"])

const GetArmorMods = Tool.make("get_armor_mods", {
  description:
    "What is slotted in owned armor pieces right now: each piece's energy (used and capacity) and its mod sockets, with the kind of mod each takes (general or the piece's slot), the mod in it, its energy cost and any stats it adds. Sockets of kind other (tuning, set bonuses) cannot be changed by a plan. Each piece names the armor set it belongs to, and setBonuses lists the set bonuses the pieces turn on together (status on) and those one more piece of the set would turn on (status one piece away); a bonus needs that many pieces of its set worn. With purpose, each set bonus gets a fit from 0 to 1, how well it serves that build; prefer armor whose set bonuses fit, and when a bonus one piece away fits well, weigh swapping a piece to turn it on. If the result says ranking unavailable, nothing has a fit. Call it with every armor piece of a build before recommending mods, so the mods and the set bonuses can back the same loop.",
  parameters: Schema.Struct({
    itemInstanceIds: Schema.Array(Schema.String),
    purpose: Schema.optional(
      Schema.String.annotate({
        description:
          "What the build does, in plain words: subclass and element, activity, stat goals and playstyle, for example 'Void Sentinel Titan build, 100 Health and 100 Class, overshields and Devour'. Pass it when weighing a build's armor, so its set bonuses are judged against it.",
      }),
    ),
  }),
  success: Json,
})

const ListArmorMods = Tool.make("list_armor_mods", {
  description:
    "Armor mods from the current patch's Bungie manifest that can go in a build socket: name, the slot they fit (general fits every piece), energy cost, effect text and stat changes. artifactOnly mods work only while unlocked in the Seasonal Artifact, so prefer the others unless the player says they have them. Filter by slot and by words in the name or effect. Use these names exactly in present_plan mods. With purpose, you get every stat mod that matches plus the other matches most relevant to the build, each with a relevance from 0 to 1, and limit is how many of those (default 15, max 40); to find a mod the ranking left out, call again with text. If the result says ranking unavailable, the list is unranked.",
  parameters: Schema.Struct({
    purpose: Schema.optional(
      Schema.String.annotate({
        description:
          "What the build does, in plain words: subclass and element, activity, stat goals and playstyle, for example 'Void Sentinel Titan build, 100 Health and 100 Class, overshields and Devour'. Pass it when picking a build's mods; leave it out to list everything that matches.",
      }),
    ),
    slot: Schema.optional(ModSlot),
    text: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Json,
})

const SearchCreatorNotes = Tool.make("search_creator_notes", {
  description:
    "Recent advice from Destiny 2 YouTube creators: short claims summarized from their videos of the last 60 days, each with channel, video title, publish date and a link to the moment it is said. Gear names were checked against the manifest. Search by weapon, perk, exotic, subclass, activity or topic words; an empty query returns the newest notes.",
  parameters: Schema.Struct({
    query: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Json,
})

const CiteSources = Tool.make("cite_sources", {
  description:
    "Record the sources your answer relies on (label, url, date as ISO). They are shown under the answer. Call it for everything you used: wishlist, manifest, articles, videos.",
  parameters: Schema.Struct({ sources: Schema.Array(SourceInput) }),
  success: Json,
})

export const GhostToolkit = Toolkit.make(
  GetCharacters,
  SearchItems,
  PresentPlan,
  CheckRolls,
  RollRecommendations,
  DescribePlugs,
  GetArmorMods,
  ListArmorMods,
  ListSubclasses,
  SearchCreatorNotes,
  CiteSources,
)

const clip = (text: string | null, max: number) =>
  text === null || text.length <= max ? text : `${text.slice(0, max)}…`

const named = (stats: ArmorStats) =>
  Object.fromEntries(ARMOR_STATS.map(([key, label]) => [label.toLowerCase(), stats[key]]))

const MOD_SLOTS = new Map<string, typeof ModSlot.Type>([
  ["enhancements.v2_general", "general"],
  ["enhancements.v2_head", "helmet"],
  ["enhancements.v2_arms", "arms"],
  ["enhancements.v2_chest", "chest"],
  ["enhancements.v2_legs", "legs"],
  ["enhancements.v2_class_item", "class"],
])

const modSlotOf = (category: string) => MOD_SLOTS.get(category)

const namedMods = (mods: Readonly<Record<string, number>>) => {
  const named = ARMOR_STATS.flatMap(([key, label]) => {
    const delta = mods[STAT[key]]
    return delta === undefined ? [] : [[label.toLowerCase(), delta] as const]
  })
  return named.length > 0 ? Object.fromEntries(named) : undefined
}

const setBonusRow = (bonus: SetBonus) => ({
  status: isActive(bonus) ? "on" : "one piece away",
  bonus: setBonusLine(bonus),
  fit: bonus.fit,
})

const compact = (i: OwnedItem) => ({
  id: i.itemInstanceId,
  hash: i.itemHash,
  name: i.name,
  type: i.typeName,
  tier: i.tier,
  slot: i.slot,
  element: i.damageType,
  power: i.power,
  location: i.location,
  characterId: i.characterId,
  equipped: i.equipped,
  locked: i.locked,
  masterwork: i.masterwork,
  classType: i.classType ?? undefined,
  statTotal: i.statTotal ?? undefined,
  stats: i.armorStats === null ? undefined : named(i.armorStats),
  perks: i.perks.length > 0 ? i.perks : undefined,
  exoticPerk: i.exoticPerk ?? undefined,
  set: i.set?.name,
  duplicates: i.duplicates,
  decision: i.decision ?? undefined,
})

type SearchFilters = (typeof SearchItems)["parametersSchema"]["Type"]

const matchingItems = (inv: Inventory, f: SearchFilters) => {
  const text = f.text?.toLowerCase()
  return inv.items.filter(
    (i) =>
      (text === undefined ||
        i.name.toLowerCase().includes(text) ||
        i.typeName.toLowerCase().includes(text) ||
        i.perks.some((p) => p.toLowerCase().includes(text))) &&
      (f.category === undefined ||
        (f.category === "weapon" ? isWeapon(i.slot) : isArmor(i.slot))) &&
      (f.slot === undefined || i.slot === f.slot) &&
      (f.tier === undefined || i.tier === f.tier) &&
      (f.location === undefined || i.location === f.location) &&
      (f.classType === undefined || i.classType === f.classType) &&
      (f.damageType === undefined || i.damageType === f.damageType) &&
      (f.duplicatesOnly !== true || i.duplicates > 0),
  )
}

export const searchItems = (inv: Inventory, f: SearchFilters) => {
  const limit = Math.min(Math.max(f.limit ?? 60, 1), 200)
  const matches = matchingItems(inv, f)
  return { total: matches.length, items: matches.slice(0, limit).map(compact) }
}

const statLabel = (label: string) => `${label.charAt(0)}${label.slice(1).toLowerCase()}`

const statsHighestFirst = (stats: ArmorStats) =>
  ARMOR_STATS.map(([key, label]) => [statLabel(label), stats[key]] as const)
    .filter(([, value]) => value > 0)
    .toSorted((a, b) => b[1] - a[1])
    .map(([label, value]) => `${label} ${value}`)

const setPerkText = (perk: ArmorSet["perks"][number]) =>
  `${perk.required} pieces ${perk.name} (${oneLine(clip(perk.description, 300) ?? "")})`

export const rankingText = (i: OwnedItem) => {
  const stats = i.armorStats === null ? [] : statsHighestFirst(i.armorStats)
  return [
    i.name,
    [i.tier, i.classType, i.typeName].filter((part) => part !== null).join(" "),
    `${i.slot} slot`,
    i.damageType === "none" ? null : `${i.damageType} element`,
    i.masterwork ? "masterworked" : null,
    stats.length > 0 ? `stats, highest first: ${stats.join(", ")} (total ${i.statTotal})` : null,
    i.perks.length > 0 ? `perks: ${i.perks.join(", ")}` : null,
    i.exoticPerk === null ? null : `exotic perk: ${i.exoticPerk}`,
    i.set === null ? null : `armor set ${i.set.name}: ${i.set.perks.map(setPerkText).join(", ")}`,
  ]
    .filter((part) => part !== null)
    .join("; ")
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const topPerSlot = (
  matches: ReadonlyArray<OwnedItem>,
  relevance: ReadonlyMap<string, number>,
  perSlot: number,
) => {
  const scored = matches
    .map((item) => ({ item, relevance: relevance.get(item.itemInstanceId) ?? 0 }))
    .toSorted((a, b) => b.relevance - a.relevance)
  const taken = new Map<string, number>()
  return scored
    .filter(({ item }) => {
      const count = taken.get(item.slot) ?? 0
      taken.set(item.slot, count + 1)
      return count < perSlot
    })
    .map(({ item, relevance }) => ({ ...compact(item), relevance: round2(relevance) }))
}

interface Found {
  readonly total: number
  readonly items: ReadonlyArray<ReturnType<typeof compact> & { readonly relevance?: number }>
  readonly ranking?: "unavailable"
}

export const findItems = (inv: Inventory, f: SearchFilters): Effect.Effect<Found, never, Jev> =>
  Effect.gen(function* () {
    if (f.purpose === undefined) return searchItems(inv, f)
    const jev = yield* Jev
    const matches = matchingItems(inv, f)
    const perSlot = Math.min(Math.max(f.limit ?? 6, 1), 20)
    return yield* jev
      .rank(
        f.purpose,
        matches.map((i) => ({ id: i.itemInstanceId, text: rankingText(i) })),
      )
      .pipe(
        Effect.map((relevance) => ({
          total: matches.length,
          items: topPerSlot(matches, relevance, perSlot),
        })),
        Effect.catchTag("JevUnavailable", () =>
          Effect.succeed({ ...searchItems(inv, f), ranking: "unavailable" as const }),
        ),
      )
  })

const setBonusText = (bonus: SetBonus) =>
  `${bonus.name}; ${bonus.set} armor set bonus for wearing ${bonus.required} pieces; effect: ${oneLine(clip(bonus.description, 300) ?? "")}`

interface JudgedSetBonuses {
  readonly setBonuses: ReadonlyArray<SetBonus>
  readonly ranking?: "unavailable"
}

/** The set bonuses, each with Jev's fit for the build `purpose` describes. */
export const judgeSetBonuses = (
  purpose: string | undefined,
  setBonuses: ReadonlyArray<SetBonus>,
): Effect.Effect<JudgedSetBonuses, never, Jev> =>
  Effect.gen(function* () {
    if (purpose === undefined || setBonuses.length === 0) return { setBonuses }
    const jev = yield* Jev
    return yield* jev
      .rank(
        purpose,
        setBonuses.map((bonus, i) => ({ id: String(i), text: setBonusText(bonus) })),
        "set bonus",
      )
      .pipe(
        Effect.map((fit) => ({
          setBonuses: setBonuses.map(
            (bonus, i) => new SetBonus({ ...bonus, fit: round2(fit.get(String(i)) ?? 0) }),
          ),
        })),
        Effect.catchTag("JevUnavailable", () =>
          Effect.succeed({ setBonuses, ranking: "unavailable" as const }),
        ),
      )
  })

/** Active set bonuses Jev judged a poor fit for the build. */
export const offBuildBonuses = (setBonuses: ReadonlyArray<SetBonus>) =>
  setBonuses.filter(
    (bonus) => isActive(bonus) && bonus.fit !== undefined && bonus.fit < OFF_BUILD_FIT,
  )

const statChanges = (mods: Readonly<Record<string, number>>) =>
  Object.entries(namedMods(mods) ?? {})
    .map(([stat, delta]) => `${stat} ${delta > 0 ? "+" : ""}${delta}`)
    .join(", ")

type ModFilters = (typeof ListArmorMods)["parametersSchema"]["Type"]

const isStatMod = (entry: ArmorModEntry) => Object.keys(entry.mods).length > 0

const armorModCatalog = (catalog: ReadonlyArray<ArmorModEntry>, f: ModFilters) => {
  const text = f.text?.toLowerCase()
  const byName = new Map<string, ArmorModEntry>()
  for (const entry of catalog) {
    const key = `${entry.category}|${entry.name.toLowerCase()}`
    const kept = byName.get(key)
    if (kept === undefined || (kept.artifact && !entry.artifact)) byName.set(key, entry)
  }
  return [...byName.values()].filter(
    (entry) =>
      (f.slot === undefined || modSlotOf(entry.category) === f.slot) &&
      (text === undefined ||
        entry.name.toLowerCase().includes(text) ||
        entry.description.toLowerCase().includes(text)),
  )
}

const modRankingText = (entry: ArmorModEntry) =>
  [
    entry.name,
    `${modSlotOf(entry.category)} armor mod`,
    `costs ${entry.energyCost} energy`,
    entry.artifact ? "Seasonal Artifact only" : null,
    entry.charged ? "uses Armor Charge" : null,
    isStatMod(entry) ? `stats: ${statChanges(entry.mods)}` : null,
    `effect: ${oneLine(clip(entry.description, 300) ?? "")}`,
  ]
    .filter((part) => part !== null)
    .join("; ")

interface FoundMod {
  readonly entry: ArmorModEntry
  readonly relevance?: number
}

const topMods = (
  mods: ReadonlyArray<ArmorModEntry>,
  relevance: ReadonlyMap<string, number>,
  limit: number,
): ReadonlyArray<FoundMod> => [
  ...mods.filter(isStatMod).map((entry) => ({ entry })),
  ...mods
    .filter((entry) => !isStatMod(entry))
    .map((entry) => ({ entry, relevance: relevance.get(String(entry.hash)) ?? 0 }))
    .toSorted((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map(({ entry, relevance }) => ({ entry, relevance: round2(relevance) })),
]

interface FoundMods {
  readonly total: number
  readonly mods: ReadonlyArray<FoundMod>
  readonly ranking?: "unavailable"
}

export const findArmorMods = (
  catalog: ReadonlyArray<ArmorModEntry>,
  f: ModFilters,
): Effect.Effect<FoundMods, never, Jev> =>
  Effect.gen(function* () {
    const mods = armorModCatalog(catalog, f)
    const unranked = { total: mods.length, mods: mods.map((entry) => ({ entry })) }
    if (f.purpose === undefined) return unranked
    const jev = yield* Jev
    const limit = Math.min(Math.max(f.limit ?? 15, 1), 40)
    return yield* jev
      .rank(
        f.purpose,
        mods
          .filter((entry) => !isStatMod(entry))
          .map((entry) => ({ id: String(entry.hash), text: modRankingText(entry) })),
      )
      .pipe(
        Effect.map((relevance) => ({ total: mods.length, mods: topMods(mods, relevance, limit) })),
        Effect.catchTag("JevUnavailable", () =>
          Effect.succeed({ ...unranked, ranking: "unavailable" as const }),
        ),
      )
  })

export interface SubclassView {
  readonly subclass: Pick<OwnedSubclass, "name" | "element" | "equipped">
  readonly defs: ReadonlyMap<number, ManifestItem>
  readonly sockets: ReadonlyArray<SubclassSocket>
  readonly plugs: ReadonlyMap<number, PlugFacts>
}

const PART_LABELS: Record<SubclassPart, string> = {
  super: "super",
  class: "class ability",
  jump: "jump",
  melee: "melee",
  grenade: "grenade",
  aspect: "aspect",
  fragment: "fragment",
}

const EFFECTS_KEPT: Partial<Record<SubclassPart, number>> = { aspect: 3, fragment: 8 }

interface SubclassOption {
  readonly part: SubclassPart
  readonly plug: SubclassPlug
  readonly slotted: boolean
  readonly effect: string | null
  readonly stats: Readonly<Record<string, number>>
}

const subclassOptions = (view: SubclassView, classType: GuardianClass) => {
  const of = (part: SubclassPart) => view.sockets.filter((socket) => socket.part === part)
  return (part: SubclassPart): ReadonlyArray<SubclassOption> => {
    const on = new Set(
      of(part)
        .filter((socket) => socket.enabled)
        .map((socket) => socket.current),
    )
    return (of(part)[0]?.options ?? []).map((plug) => ({
      part,
      plug,
      slotted: on.has(plug.hash),
      effect: clip(plug.description || (view.plugs.get(plug.hash)?.description ?? ""), 240),
      stats: plugStatMods(view.plugs.get(plug.hash), classType),
    }))
  }
}

const optionId = (option: SubclassOption) => `${option.part}:${option.plug.hash}`

const fragmentSlots = (view: SubclassView, option: SubclassOption) =>
  view.plugs.get(option.plug.hash)?.fragmentSlots ?? 0

const optionRankingText = (view: SubclassView, option: SubclassOption) =>
  [
    option.plug.name,
    `${view.subclass.name} (${view.subclass.element}) ${PART_LABELS[option.part]}`,
    option.part === "aspect" ? `brings ${fragmentSlots(view, option)} fragment slots` : null,
    Object.keys(option.stats).length > 0 ? `stats: ${statChanges(option.stats)}` : null,
    option.effect ? `effect: ${oneLine(option.effect)}` : null,
  ]
    .filter((part) => part !== null)
    .join("; ")

const ALL_PARTS: ReadonlyArray<SubclassPart> = [
  "super",
  "class",
  "jump",
  "melee",
  "grenade",
  "aspect",
  "fragment",
]

const subclassCandidates = (view: SubclassView, classType: GuardianClass) => {
  const options = subclassOptions(view, classType)
  return ALL_PARTS.flatMap(options).map((option) => ({
    id: optionId(option),
    text: optionRankingText(view, option),
  }))
}

export const subclassDetail = (
  view: SubclassView,
  classType: GuardianClass,
  relevance?: ReadonlyMap<string, number>,
) => {
  const options = subclassOptions(view, classType)
  const nameOf = (hash: number) => {
    const def = view.defs.get(hash)
    return def === undefined || /^empty /i.test(def.name) ? null : def.name
  }
  const ranked = <R extends { readonly effect: string | null }>(
    part: SubclassPart,
    row: (option: SubclassOption) => R,
  ) => {
    const rows = options(part)
    if (relevance === undefined) return rows.map(row)
    return rows
      .map((option) => ({ option, relevance: relevance.get(optionId(option)) ?? 0 }))
      .toSorted((a, b) => b.relevance - a.relevance)
      .map(({ option, relevance }, rank) => ({
        ...row(option),
        effect: rank < (EFFECTS_KEPT[part] ?? 0) || option.slotted ? option.effect : undefined,
        relevance: round2(relevance),
      }))
  }
  const ability = (part: SubclassPart) => {
    const socket = view.sockets.find((s) => s.part === part)
    if (socket === undefined) return undefined
    return {
      slotted: nameOf(socket.current),
      options:
        relevance === undefined
          ? socket.options.map((plug) => plug.name)
          : options(part)
              .map((option) => ({
                name: option.plug.name,
                relevance: round2(relevance.get(optionId(option)) ?? 0),
              }))
              .toSorted((a, b) => b.relevance - a.relevance),
    }
  }
  return {
    name: view.subclass.name,
    element: view.subclass.element,
    equipped: view.subclass.equipped,
    aspectSockets: view.sockets.filter((socket) => socket.part === "aspect").length,
    super: ability("super"),
    classAbility: ability("class"),
    jump: ability("jump"),
    melee: ability("melee"),
    grenade: ability("grenade"),
    aspects: ranked("aspect", (option) => ({
      name: option.plug.name,
      fragmentSlots: fragmentSlots(view, option),
      effect: option.effect,
      slotted: option.slotted || undefined,
    })),
    fragments: ranked("fragment", (option) => ({
      name: option.plug.name,
      stats: namedMods(option.stats),
      effect: option.effect,
      slotted: option.slotted || undefined,
    })),
  }
}

export const findSubclassDetail = (
  view: SubclassView,
  classType: GuardianClass,
  purpose: string | undefined,
): Effect.Effect<
  ReturnType<typeof subclassDetail> & { readonly ranking?: "unavailable" },
  never,
  Jev
> =>
  Effect.gen(function* () {
    if (purpose === undefined) return subclassDetail(view, classType)
    const jev = yield* Jev
    return yield* jev.rank(purpose, subclassCandidates(view, classType)).pipe(
      Effect.map((relevance) => subclassDetail(view, classType, relevance)),
      Effect.catchTag("JevUnavailable", () =>
        Effect.succeed({ ...subclassDetail(view, classType), ranking: "unavailable" as const }),
      ),
    )
  })

// A full curated match is the strongest signal; "god" tags mark the
// curator's top pick. Partial matches scale with how many listed perks the
// roll has, and a trash match overrides everything.
const scoreFor = (
  full: ReadonlyArray<RollMatch>,
  partial: ReadonlyArray<RollMatch>,
  rolls: number,
) => {
  if (full.some((m) => m.roll.trash)) return { score: 10, basis: "matches a wishlist trash roll" }
  const keepers = full.filter((m) => !m.roll.trash)
  if (keepers.some((m) => m.roll.block.tags.some((t) => /god/i.test(t)))) {
    return { score: 95, basis: "fully matches a wishlist roll tagged god" }
  }
  if (keepers.length > 0) return { score: 85, basis: "fully matches a wishlist roll" }
  const best = partial[0]
  if (best !== undefined) {
    return {
      score: Math.round(40 + (40 * best.matched) / best.total),
      basis: `has ${best.matched} of ${best.total} perks of the closest wishlist roll`,
    }
  }
  if (rolls > 0) return { score: 30, basis: "has none of the wishlist's recommended perks" }
  return { score: null, basis: "the wishlist has no entries for this weapon" }
}

export const GhostToolkitHandlers = GhostToolkit.toLayer(
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const jobs = yield* JobsRepo
    const current = yield* CurrentJob
    const manifest = yield* Manifest
    const wishlist = yield* Wishlist
    const creators = yield* CreatorNotes
    const chargeEffects = yield* ChargeEffects
    const jev = yield* Jev

    const withInventory = (f: (inv: Inventory) => Effect.Effect<string>) =>
      profile.inventory.pipe(
        Effect.matchEffect({ onFailure: (e) => Effect.succeed(explain(e)), onSuccess: f }),
      )

    const toSources = (input: ReadonlyArray<typeof SourceInput.Type>) => input.map(toSource)

    const nameLookup = (hashes: Iterable<number>) =>
      Effect.map(manifest.lookup(hashes), (defs) => (hash: number) => defs.get(hash)?.name)

    const get_characters = () =>
      withInventory((inv) =>
        Effect.map(manifest.capacities, (capacities) =>
          JSON.stringify({
            characters: inv.characters.map((c) => ({
              id: c.characterId,
              class: c.classType,
              light: c.light,
              subclass: c.subclass,
              element: c.element,
              stats: named(c.stats),
              equipped: inv.items
                .filter((i) => i.equipped && i.characterId === c.characterId)
                .map(compact),
              postmaster: {
                count: c.postmasterCount,
                capacity: capacities.postmaster,
                items: inv.items
                  .filter((i) => i.location === "postmaster" && i.characterId === c.characterId)
                  .map(compact),
              },
            })),
            vault: { count: inv.vaultCount, capacity: capacities.vault },
          }),
        ),
      )

    const search_items = (filters: SearchFilters) =>
      withInventory((inv) =>
        findItems(inv, filters).pipe(
          Effect.map((found) => JSON.stringify(found)),
          Effect.provideService(Jev, jev),
        ),
      )

    const composing = <A, E>(
      effect: Effect.Effect<A, E, Manifest | ProfileStore | ChargeEffects>,
    ): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.provideService(Manifest, manifest),
        Effect.provideService(ProfileStore, profile),
        Effect.provideService(ChargeEffects, chargeEffects),
      )

    const present_plan = (input: PlanInput) =>
      Effect.gen(function* () {
        const job = yield* current.get
        if (Option.isNone(job)) {
          return "Error: no Ghost request is running, so there is nothing to attach a plan to."
        }
        return yield* withInventory((inv) =>
          Effect.gen(function* () {
            const recipe: BuildRecipe = {
              ...input,
              characterId: job.value.characterId || (inv.characters[0]?.characterId ?? null),
            }
            const build = yield* composing(composeBuild(recipe, inv))
            const refusal = buildRules(recipe, build)
            if (refusal !== undefined) return yield* refusal
            const judged = yield* judgeSetBonuses(recipe.purpose, build.plan.setBonuses ?? []).pipe(
              Effect.provideService(Jev, jev),
            )
            const offBuild = offBuildBonuses(judged.setBonuses)
            const plan = new Plan({
              ...build.plan,
              setBonuses: judged.setBonuses.length > 0 ? judged.setBonuses : undefined,
              saveable: recipe.kind === "build" ? true : undefined,
            })
            yield* jobs.setPlan(job.value.id, plan).pipe(Effect.orDie)
            if (recipe.kind === "build") {
              yield* jobs.setRecipe(job.value.id, recipe).pipe(Effect.orDie)
            }
            if (recipe.sources !== undefined && recipe.sources.length > 0) {
              yield* jobs.addSources(job.value.id, toSources(recipe.sources)).pipe(Effect.orDie)
            }
            const actionable = plan.rows.filter((r) => r.action !== "none").length
            const unresearched = [
              ...new Set(
                plan.rows.flatMap((row) =>
                  (row.armorMods ?? [])
                    .filter((mod) => mod.charged && mod.chargeEffect === undefined)
                    .map((mod) => mod.name),
                ),
              ),
            ]
            const missing =
              unresearched.length > 0
                ? ` These armor charge mods still have no chargeEffect, so the card cannot say what they add: ${unresearched.join(", ")}. Look them up and call present_plan again with chargeEffects.`
                : ""
            const subclassNote =
              build.subclassChanges === null
                ? ""
                : build.subclassChanges.length > 0
                  ? ` Subclass: ${build.subclassChanges.join(", ")}.`
                  : " Subclass: already as picked, nothing changes."
            const offBuildNote =
              offBuild.length > 0
                ? ` These set bonuses the armor turns on fit the build poorly: ${offBuild.map((bonus) => `${bonus.name} (${bonus.set}, fit ${bonus.fit})`).join(", ")}; tell the player the trade-off or reconsider the armor.`
                : ""
            return `Plan saved with ${plan.rows.length} rows (${actionable} actionable, ${build.modSwaps} mod swaps).${subclassNote} The player will see it under your answer and confirm in the app.${missing}${offBuildNote}`
          }).pipe(Effect.catchTag("BuildRefusal", (refusal) => Effect.succeed(refusal.message))),
        )
      })

    const check_rolls = ({
      itemInstanceIds,
    }: {
      readonly itemInstanceIds: ReadonlyArray<string>
    }) =>
      withInventory((inv) =>
        Effect.gen(function* () {
          const owned = new Map(inv.items.map((i) => [i.itemInstanceId, i]))
          const picked = itemInstanceIds.flatMap((id) => {
            const item = owned.get(id)
            return item === undefined ? [] : [item]
          })
          const unknown = itemInstanceIds.filter((id) => !owned.has(id))
          const rolls = yield* wishlist.rollsFor(picked.map((i) => i.itemHash))
          const hashes = new Set<number>()
          for (const item of picked) for (const h of item.plugHashes) hashes.add(h)
          for (const list of rolls.values())
            for (const r of list) for (const h of r.perkHashes) hashes.add(h)
          const nameOf = yield* nameLookup(hashes)
          const names = (list: ReadonlyArray<number>) => list.map((h) => nameOf(h) ?? `#${h}`)
          const describeMatch = (m: RollMatch, has: (hash: number) => boolean) => ({
            perks: names(m.roll.perkHashes),
            missing: m.full ? undefined : names(m.roll.perkHashes.filter((h) => !has(h))),
            notes: clip(m.roll.block.notes, 500),
            tags: m.roll.block.tags,
            section: m.roll.block.sectionTitle,
            url: m.roll.block.sectionUrl,
            date: m.roll.block.sectionDate,
          })
          const items = picked.map((item) => {
            const list = rolls.get(item.itemHash) ?? []
            const check = checkRoll(item.plugHashes, list, nameOf)
            const { score, basis } = scoreFor(check.full, check.partial, list.length)
            const has = perkMatcher(item.plugHashes, nameOf)
            return {
              id: item.itemInstanceId,
              name: item.name,
              perks: item.perks,
              plugs: names(item.plugHashes),
              wishlistRolls: list.length,
              trash: check.trash,
              fullMatches: check.full.slice(0, 5).map((m) => describeMatch(m, has)),
              partialMatches:
                check.full.length > 0 ? [] : check.partial.map((m) => describeMatch(m, has)),
              suggestedScore: score,
              scoreBasis: basis,
            }
          })
          return JSON.stringify({
            wishlist: { url: WISHLIST_URL, asOf: yield* wishlist.asOf },
            unknownIds: unknown.length > 0 ? unknown : undefined,
            items,
          })
        }).pipe(
          Effect.catchTag("WishlistError", (e) => Effect.succeed(explain(e))),
          Effect.catchTag("BungieError", (e) => Effect.succeed(explain(e))),
        ),
      )

    const roll_recommendations = ({ itemHash }: { readonly itemHash: number }) =>
      Effect.gen(function* () {
        const rolls = (yield* wishlist.rollsFor([itemHash])).get(itemHash) ?? []
        const hashes = new Set<number>([itemHash])
        for (const r of rolls) for (const h of r.perkHashes) hashes.add(h)
        const nameOf = yield* nameLookup(hashes)
        return JSON.stringify({
          item: nameOf(itemHash) ?? `#${itemHash}`,
          wishlist: { url: WISHLIST_URL, asOf: yield* wishlist.asOf },
          recommendations: recommendations(rolls, nameOf).map((r) => ({
            ...r,
            notes: clip(r.notes, 600),
          })),
        })
      }).pipe(
        Effect.catchTag("WishlistError", (e) => Effect.succeed(explain(e))),
        Effect.catchTag("BungieError", (e) => Effect.succeed(explain(e))),
      )

    const get_armor_mods = ({
      itemInstanceIds,
      purpose,
    }: (typeof GetArmorMods)["parametersSchema"]["Type"]) =>
      withInventory((inv) =>
        Effect.gen(function* () {
          const picked = inv.items.filter(
            (i) => itemInstanceIds.includes(i.itemInstanceId) && i.armorStats !== null,
          )
          const hashes = picked.flatMap((i) => i.modSockets.map((socket) => socket.plugHash))
          const defs = yield* manifest
            .lookup(hashes)
            .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
          const plugs = yield* manifest.plugFacts(hashes)
          const sockets = new Map(
            picked.map((item) => [item.itemInstanceId, socketsNow(item, defs, plugs)]),
          )
          const effects = yield* chargeEffects
            .forMods(
              [...sockets.values()]
                .flat()
                .flatMap((socket) => (socket.mod?.charged ? [socket.mod.name] : [])),
            )
            .pipe(Effect.orDie)
          const judged = yield* judgeSetBonuses(
            purpose,
            setBonusesFor(
              yield* manifest.armorSets,
              picked.map((item) => item.itemHash),
            ),
          ).pipe(Effect.provideService(Jev, jev))
          return JSON.stringify({
            unknownIds: itemInstanceIds.filter(
              (id) => !picked.some((i) => i.itemInstanceId === id),
            ),
            ranking: judged.ranking,
            setBonuses: judged.setBonuses.map(setBonusRow),
            pieces: picked.map((item) => ({
              id: item.itemInstanceId,
              name: item.name,
              slot: item.slot,
              set: item.set?.name,
              energy: item.energy,
              sockets: (sockets.get(item.itemInstanceId) ?? []).map((socket) => ({
                kind: modSlotOf(socket.category) ?? "other",
                mod: socket.mod?.name ?? null,
                cost: socket.mod?.cost,
                stats: socket.mod === null ? undefined : namedMods(socket.mod.mods),
                charged: socket.mod?.charged || undefined,
                chargeEffect: socket.mod?.charged
                  ? (effects.get(socket.mod.name.toLowerCase())?.effect ?? null)
                  : undefined,
              })),
            })),
          })
        }),
      )

    const list_armor_mods = (input: ModFilters) =>
      Effect.gen(function* () {
        const found = yield* findArmorMods(yield* manifest.armorMods, input).pipe(
          Effect.provideService(Jev, jev),
        )
        const charged = found.mods.filter(({ entry }) => entry.charged)
        const effects = yield* chargeEffects
          .forMods(charged.map(({ entry }) => entry.name))
          .pipe(Effect.orDie)
        return JSON.stringify({
          total: found.total,
          ranking: found.ranking,
          mods: found.mods.map(({ entry, relevance }) => ({
            name: entry.name,
            slot: modSlotOf(entry.category),
            cost: entry.energyCost,
            effect: clip(entry.description, 300),
            stats: namedMods(entry.mods),
            artifactOnly: entry.artifact || undefined,
            charged: entry.charged || undefined,
            chargeEffect: entry.charged
              ? (effects.get(entry.name.toLowerCase())?.effect ?? null)
              : undefined,
            relevance,
          })),
        })
      })

    const list_subclasses = (input: (typeof ListSubclasses)["parametersSchema"]["Type"]) =>
      withInventory((inv) =>
        Effect.gen(function* () {
          const job = yield* current.get
          const character = pickCharacter(
            inv,
            input.characterId ?? Option.getOrNull(job)?.characterId,
          )
          if (character === undefined) return "Error: no characters on this account."
          const choices = yield* composing(subclassChoices(character))
          const nameOf = (choice: SubclassChoice, hash: number) => {
            const def = choice.defs.get(hash)
            return def === undefined || /^empty /i.test(def.name) ? null : def.name
          }
          if (input.subclass === undefined) {
            return JSON.stringify({
              characterId: character.characterId,
              class: character.classType,
              subclasses: choices.map((choice) => ({
                name: choice.subclass.name,
                element: choice.subclass.element,
                equipped: choice.subclass.equipped,
                slotted: Object.fromEntries(
                  ["super", "aspect", "fragment"].map((part) => [
                    part,
                    choice.sockets
                      .filter((socket) => socket.part === part && socket.enabled)
                      .flatMap((socket) => nameOf(choice, socket.current) ?? []),
                  ]),
                ),
              })),
            })
          }
          const choice = findSubclass(choices, input.subclass)
          if (choice === undefined) return unknownSubclass(choices, input.subclass)
          return JSON.stringify(
            yield* findSubclassDetail(choice, character.classType, input.purpose).pipe(
              Effect.provideService(Jev, jev),
            ),
          )
        }).pipe(Effect.catch((error) => Effect.succeed(explain(error)))),
      )

    const describe_plugs = (input: {
      readonly names?: ReadonlyArray<string> | undefined
      readonly hashes?: ReadonlyArray<number> | undefined
    }) =>
      Effect.gen(function* () {
        const byHash = yield* manifest.lookup(input.hashes ?? [])
        const byName = yield* manifest.findByName(input.names ?? [])
        const seen = new Set<string>()
        const plugs = [...byHash.values(), ...byName].flatMap((def) => {
          const key = `${def.name}\u0000${def.description}`
          if (seen.has(key)) return []
          seen.add(key)
          return [
            { hash: def.hash, name: def.name, type: def.typeName, description: def.description },
          ]
        })
        const found = new Set(plugs.map((p) => p.name.toLowerCase()))
        const missing = (input.names ?? []).filter((n) => !found.has(n.toLowerCase()))
        return JSON.stringify({
          source: "Bungie manifest (current patch)",
          plugs,
          notFound: missing.length > 0 ? missing : undefined,
        })
      }).pipe(Effect.catchTag("BungieError", (e) => Effect.succeed(explain(e))))

    const search_creator_notes = (input: {
      readonly query: string
      readonly limit?: number | undefined
    }) =>
      Effect.gen(function* () {
        const found = yield* creators.search(
          input.query,
          Math.min(Math.max(input.limit ?? 12, 1), 30),
        )
        const now = Date.now()
        return JSON.stringify({
          maxAgeDays: NOTE_MAX_AGE_DAYS,
          captionsAvailable: found.captionsAvailable,
          channels: found.channels,
          notes: found.notes.map((n) => ({
            ...n,
            ageDays: Math.floor((now - Date.parse(n.publishedAt)) / 86_400_000),
            unverifiedNames: n.unverifiedNames.length > 0 ? n.unverifiedNames : undefined,
          })),
        })
      })

    const cite_sources = ({
      sources,
    }: {
      readonly sources: ReadonlyArray<typeof SourceInput.Type>
    }) =>
      Effect.gen(function* () {
        const job = yield* current.get
        if (Option.isNone(job)) return "Error: no Ghost request is running."
        yield* jobs.addSources(job.value.id, toSources(sources)).pipe(Effect.orDie)
        return `Recorded ${sources.length} source(s).`
      })

    return {
      get_characters,
      search_items,
      present_plan,
      check_rolls,
      roll_recommendations,
      describe_plugs,
      get_armor_mods,
      list_armor_mods,
      list_subclasses,
      search_creator_notes,
      cite_sources,
    }
  }),
)
