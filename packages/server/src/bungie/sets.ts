import { SetBonus, TargetSet } from '@ghost/contract'
import type { ArmorSet } from './manifest.ts'

/** The set each armor item hash belongs to. */
export const setsByItem = (sets: ReadonlyArray<ArmorSet>): ReadonlyMap<number, ArmorSet> =>
  new Map(sets.flatMap((set) => set.items.map((hash): [number, ArmorSet] => [hash, set])))

export const isActive = (bonus: Pick<SetBonus, 'required' | 'worn'>) => bonus.worn >= bonus.required

const fewestPiecesFirst = (a: SetBonus, b: SetBonus) =>
  a.required - b.required || a.set.localeCompare(b.set)

/** Every bonus of the set, with `worn` pieces of it worn, fewest pieces needed first. */
export const everySetBonus = (set: ArmorSet, worn: number): ReadonlyArray<SetBonus> =>
  set.perks
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
    .toSorted(fewestPiecesFirst)

/**
 * The bonuses the worn pieces turn on, then those one more piece of their set
 * would turn on; fewest pieces needed first within each.
 */
export const setBonusesFor = (
  sets: ReadonlyArray<ArmorSet>,
  itemHashes: ReadonlyArray<number>,
): ReadonlyArray<SetBonus> => {
  const wearing = [...new Set(itemHashes)]
  const bonuses = sets.flatMap((set) => {
    const members = new Set(set.items)
    const worn = wearing.filter((hash) => members.has(hash)).length
    if (worn === 0) return []
    return everySetBonus(set, worn).filter((bonus) => bonus.required - bonus.worn <= 1)
  })
  return [
    ...bonuses.filter(isActive).toSorted(fewestPiecesFirst),
    ...bonuses.filter((bonus) => !isActive(bonus)).toSorted(fewestPiecesFirst),
  ]
}

export interface TargetSetInput {
  readonly set: string
  readonly why: string
  readonly source?: string | undefined
}

/**
 * The set the build should farm toward, with how much of it the build wears;
 * 'worn' once the build wears enough of it to turn every bonus on.
 */
export const targetSetFor = (
  sets: ReadonlyArray<ArmorSet>,
  itemHashes: ReadonlyArray<number>,
  target: TargetSetInput,
): TargetSet | 'worn' | 'unknown' => {
  const set = sets.find((each) => each.name.toLowerCase() === target.set.trim().toLowerCase())
  if (set === undefined) return 'unknown'
  const members = new Set(set.items)
  const worn = new Set(itemHashes.filter((hash) => members.has(hash))).size
  const required = Math.max(0, ...set.perks.map((perk) => perk.required))
  if (worn >= required) return 'worn'
  return new TargetSet({
    set: set.name,
    why: target.why,
    source: target.source ?? null,
    worn,
    required,
    bonuses: everySetBonus(set, worn),
  })
}
