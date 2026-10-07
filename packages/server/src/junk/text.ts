import type { OwnedItem, Tuning } from "../bungie/inventory.ts"
import type { ManifestItem } from "../bungie/manifest.ts"
import { ARMOR_STATS } from "../bungie/masterwork.ts"

const COSMETIC =
  /ornament|shader|tracker|memento|emote|transmat|deprecated|catalyst|restore defaults|combat flair|\bmod$/i
const EMPTY = /^empty /i

const title = (label: string) => `${label.charAt(0)}${label.slice(1).toLowerCase()}`

const tuningLine = (tuning: Tuning | null) => {
  if (tuning === null) return null
  if (tuning === "any") return "tunable to any stat"
  if (tuning === "balanced") return "balanced tuning only"
  const label = ARMOR_STATS.find(([key]) => key === tuning)?.[1] ?? tuning
  return `tuned stat ${title(label)}`
}

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
    tuningLine(item.tuning),
    roll.length > 0 ? `perks: ${roll.join(", ")}` : null,
    item.intrinsics.length === 0 ? null : `exotic perks: ${item.intrinsics.toSorted().join(", ")}`,
    item.set === null ? null : `armor set ${item.set.name}`,
  ]
    .filter((part) => part !== null)
    .join("; ")
}
