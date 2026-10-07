import type { OwnedItem } from "../bungie/inventory.ts"
import type { ManifestItem } from "../bungie/manifest.ts"
import { ARMOR_STATS } from "../bungie/masterwork.ts"

const COSMETIC = /ornament|shader|tracker|memento|emote|transmat|deprecated|catalyst|\bmod$/i
const EMPTY = /^empty /i

const title = (label: string) => `${label.charAt(0)}${label.slice(1).toLowerCase()}`

/** A weapon's roll as "Type: Name" lines, sorted, so socket order never changes the text. */
export const rollLines = (
  plugHashes: ReadonlyArray<number>,
  plugs: ReadonlyMap<number, ManifestItem>,
) =>
  plugHashes
    .flatMap((hash) => {
      const plug = plugs.get(hash)
      if (plug === undefined || plug.typeName === "" || plug.name === "") return []
      if (COSMETIC.test(plug.typeName) || EMPTY.test(plug.name)) return []
      return [`${plug.typeName}: ${plug.name}`]
    })
    .toSorted()

/** What Jev reads about an owned weapon or armor piece; the same item always gives the same text. */
export const itemText = (item: OwnedItem, plugs: ReadonlyMap<number, ManifestItem>) => {
  const stats = item.armorStats
  const roll = rollLines(item.plugHashes, plugs)
  return [
    item.name,
    [item.tier, item.classType, item.typeName].filter((part) => part !== null).join(" "),
    `${item.slot} slot`,
    item.damageType === "none" ? null : `${item.damageType} element`,
    item.masterwork ? "masterworked" : "not masterworked",
    item.gearTier ? `gear tier ${item.gearTier}` : null,
    stats === null
      ? null
      : `stats: ${ARMOR_STATS.map(([key, label]) => `${title(label)} ${stats[key]}`).join(", ")} (total ${item.statTotal})`,
    roll.length > 0 ? `perks: ${roll.join(", ")}` : null,
    item.exoticPerk === null ? null : `exotic perk: ${item.exoticPerk.name}`,
    item.set === null ? null : `armor set ${item.set.name}`,
  ]
    .filter((part) => part !== null)
    .join("; ")
}
