import type { ArmorMod } from '@ghost/contract'

export interface ChargedMod {
  readonly mod: ArmorMod
  readonly copies: number
}

/** The armor charge mods in a set of mods, one entry per mod with how many copies are slotted. */
export const chargedMods = (mods: readonly ArmorMod[]): ChargedMod[] => {
  const byName = new Map<string, ChargedMod>()
  for (const mod of mods) {
    if (!mod.charged) continue
    const seen = byName.get(mod.name)
    byName.set(mod.name, {
      mod: seen?.mod.chargeEffect ? seen.mod : mod,
      copies: (seen?.copies ?? 0) + 1,
    })
  }
  return [...byName.values()]
}
