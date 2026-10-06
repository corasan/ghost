import { SetBonus } from "@ghost/contract"
import type { ArmorSet } from "./manifest.ts"

/** The name of the set each armor item hash belongs to. */
export const setNames = (sets: ReadonlyArray<ArmorSet>): ReadonlyMap<number, string> =>
  new Map(sets.flatMap((set) => set.items.map((hash): [number, string] => [hash, set.name])))

/** The bonuses the worn pieces turn on, fewest pieces needed first. */
export const setBonusesFor = (
  sets: ReadonlyArray<ArmorSet>,
  itemHashes: ReadonlyArray<number>,
): ReadonlyArray<SetBonus> => {
  const wearing = [...new Set(itemHashes)]
  return sets
    .flatMap((set) => {
      const members = new Set(set.items)
      const worn = wearing.filter((hash) => members.has(hash)).length
      return set.perks
        .filter((perk) => worn >= perk.required)
        .map(
          (perk) =>
            new SetBonus({
              name: perk.name,
              description: perk.description,
              icon: perk.icon,
              set: set.name,
              required: perk.required,
              worn,
            }),
        )
    })
    .toSorted((a, b) => a.required - b.required || a.set.localeCompare(b.set))
}
