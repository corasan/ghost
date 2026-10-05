import {
  ArmorMod,
  type GuardianClass,
  LoadoutAbility,
  LoadoutPlug,
  StatMod,
  SubclassLoadout,
} from "@ghost/contract"
import { type CharacterInfo, type OwnedItem, STAT, type SubclassPlug } from "./inventory.ts"
import type { ManifestItem, PlugFacts, StatFacts } from "./manifest.ts"
import { ARMOR_STATS, statLabel } from "./masterwork.ts"

const CLASS_STAT: Record<GuardianClass, keyof typeof STAT> = {
  titan: "resilience",
  hunter: "mobility",
  warlock: "recovery",
}

/**
 * A character's subclass as the app shows it: each plug's effect text, the
 * slots an aspect brings, and each fragment's stat changes under the same
 * labels the stats use. The character's totals already include those changes.
 */
export const describeLoadout = ({
  character,
  plugs,
  facts,
}: {
  readonly character: Pick<
    CharacterInfo,
    "classType" | "subclass" | "subclassIcon" | "element" | "loadout"
  >
  readonly plugs: ReadonlyMap<number, PlugFacts>
  readonly facts: StatFacts
}): SubclassLoadout => {
  const plug = (from: SubclassPlug) => {
    const known = plugs.get(from.hash)
    return new LoadoutPlug({
      name: from.name,
      description: from.description || (known?.description ?? ""),
      icon: from.icon,
      mods: ARMOR_STATS.flatMap(([key, label]) => {
        const delta =
          known?.mods[STAT[key]] ??
          (key === CLASS_STAT[character.classType] ? known?.classMods[STAT[key]] : undefined)
        return delta === undefined
          ? []
          : [new StatMod({ label: statLabel(key, label, facts), delta })]
      }),
      ...(known !== undefined && known.fragmentSlots > 0
        ? { fragmentSlots: known.fragmentSlots }
        : {}),
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
      ({ kind, name, icon }) => new LoadoutAbility({ kind, name, icon }),
    ),
    aspects: loadout.aspects.map(plug),
    fragments: loadout.fragments.map(plug),
  })
}

export const loadoutPlugHashes = ({ loadout }: Pick<CharacterInfo, "loadout">) =>
  [...loadout.aspects, ...loadout.fragments].map((plug) => plug.hash)

/** The mods slotted in an armor piece, each with its energy cost and the stats it adds. */
export const describeArmorMods = ({
  item,
  defs,
  plugs,
  facts,
}: {
  readonly item: Pick<OwnedItem, "modSlots">
  readonly defs: ReadonlyMap<number, ManifestItem>
  readonly plugs: ReadonlyMap<number, PlugFacts>
  readonly facts: StatFacts
}): ReadonlyArray<ArmorMod> =>
  item.modSlots.flatMap((hash) => {
    const def = hash === null ? undefined : defs.get(hash)
    if (hash === null || def === undefined) return []
    const known = plugs.get(hash)
    return [
      new ArmorMod({
        name: def.name,
        icon: def.icon,
        description: def.description || (known?.description ?? ""),
        cost: known?.energyCost ?? 0,
        mods: ARMOR_STATS.flatMap(([key, label]) => {
          const delta = known?.mods[STAT[key]]
          return delta === undefined
            ? []
            : [new StatMod({ label: statLabel(key, label, facts), delta })]
        }),
      }),
    ]
  })
