import {
  type GuardianClass,
  Keyword,
  LoadoutAbility,
  LoadoutPlug,
  StatMod,
  type SubclassChange,
  SubclassLoadout,
} from "@ghost/contract"
import { type CharacterInfo, STAT, type SlottedPlugs, type SubclassPlug } from "./inventory.ts"
import type { PlugFacts, StatFacts, StatMods } from "./manifest.ts"
import { ARMOR_STATS, statLabel } from "./masterwork.ts"

const CLASS_STAT: Record<GuardianClass, keyof typeof STAT> = {
  titan: "resilience",
  hunter: "mobility",
  warlock: "recovery",
}

/** What a plug does to each armor stat on this class: of its conditional changes, only the one to the class's own stat applies. */
export const plugStatMods = (known: PlugFacts | undefined, classType: GuardianClass): StatMods => {
  if (known === undefined) return {}
  const own = STAT[CLASS_STAT[classType]]
  const conditional = known.classMods[own]
  return conditional === undefined ? known.mods : { [own]: conditional, ...known.mods }
}

/**
 * What trading one set of aspects and fragments for another does to each
 * armor stat, keyed by stat hash. The character's totals include the plugs it
 * has slotted, so a build on other plugs takes theirs out and adds its own.
 */
export const loadoutStatChange = ({
  from,
  to,
  plugs,
  classType,
}: {
  readonly from: ReadonlyArray<number>
  readonly to: ReadonlyArray<number>
  readonly plugs: ReadonlyMap<number, PlugFacts>
  readonly classType: GuardianClass
}): StatMods => {
  const change: Record<string, number> = {}
  const add = (hashes: ReadonlyArray<number>, sign: number) => {
    for (const hash of hashes)
      for (const [stat, delta] of Object.entries(plugStatMods(plugs.get(hash), classType)))
        change[stat] = (change[stat] ?? 0) + sign * delta
  }
  add(to, 1)
  add(from, -1)
  return change
}

/**
 * A subclass as the app shows it: each plug's effect text, the slots an
 * aspect brings, and each fragment's stat changes under the same labels the
 * stats use. `swapped` maps each plug a build puts in to the one it replaces.
 */
export const describeLoadout = ({
  character,
  plugs,
  facts,
  swapped = new Map(),
  change,
}: {
  readonly character: Pick<
    CharacterInfo,
    "classType" | "subclass" | "subclassIcon" | "element" | "loadout"
  >
  readonly plugs: ReadonlyMap<number, PlugFacts>
  readonly facts: StatFacts
  readonly swapped?: ReadonlyMap<number, string | null>
  readonly change?: SubclassChange | undefined
}): SubclassLoadout => {
  const plug = (from: SubclassPlug) => {
    const known = plugs.get(from.hash)
    const mods = plugStatMods(known, character.classType)
    const replaces = swapped.get(from.hash)
    return new LoadoutPlug({
      name: from.name,
      description: from.description || (known?.description ?? ""),
      icon: from.icon,
      mods: ARMOR_STATS.flatMap(([key, label]) => {
        const delta = mods[STAT[key]]
        return delta === undefined
          ? []
          : [new StatMod({ label: statLabel(key, label, facts), delta })]
      }),
      fragmentSlots:
        known !== undefined && known.fragmentSlots > 0 ? known.fragmentSlots : undefined,
      swap: replaces === undefined ? undefined : true,
      replaces,
      keywords: known?.keywords.map((keyword) => new Keyword(keyword)),
    })
  }
  const { loadout } = character
  return new SubclassLoadout({
    classType: character.classType,
    subclass: character.subclass,
    icon: character.subclassIcon,
    element: character.element,
    super: loadout.super === null ? null : plug(loadout.super),
    abilities: loadout.abilities.map(
      ({ kind, name, icon, hash }) =>
        new LoadoutAbility({ kind, name, icon, swap: swapped.has(hash) ? true : undefined }),
    ),
    aspects: loadout.aspects.map(plug),
    fragments: loadout.fragments.map(plug),
    change,
  })
}

export const loadoutPlugHashes = ({ loadout }: { readonly loadout: SlottedPlugs }) =>
  [...loadout.aspects, ...loadout.fragments].map((plug) => plug.hash)
