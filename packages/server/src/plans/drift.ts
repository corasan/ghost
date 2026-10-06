import type { Plan } from "@ghost/contract"
import type { Inventory } from "../bungie/inventory.ts"

const names = (plugs: ReadonlyArray<{ readonly name: string }>) =>
  plugs.map((plug) => plug.name).sort()

const differ = (
  planned: ReadonlyArray<{ readonly name: string }>,
  worn: ReadonlyArray<{ readonly name: string }>,
) => names(planned).join("|") !== names(worn).join("|")

export const drift = (
  plan: Plan,
  inventory: Inventory,
  characterId: string,
): ReadonlyArray<string> => {
  const owned = new Map(inventory.items.map((item) => [item.itemInstanceId, item]))
  const pieces = plan.rows
    .filter((row) => row.action === "equip" || row.action === "none")
    .flatMap((row) => {
      const item = owned.get(row.itemInstanceId)
      return item === undefined
        ? [`${row.name} is no longer owned`]
        : item.equipped && item.characterId === characterId
          ? []
          : [`${row.name} is not equipped`]
    })
  const loadout = plan.loadout
  const character = inventory.characters.find((each) => each.characterId === characterId)
  if (loadout === undefined) return pieces
  if (character === undefined) return [...pieces, "the character is gone"]
  const subclass =
    loadout.subclass !== null && character.subclass !== loadout.subclass
      ? [`${character.subclass ?? "no subclass"} is equipped, not ${loadout.subclass}`]
      : [
          loadout.super !== null && character.loadout.super?.name !== loadout.super.name
            ? "the super is not the planned one"
            : null,
          differ(loadout.aspects, character.loadout.aspects)
            ? "the aspects are not as planned"
            : null,
          differ(loadout.fragments, character.loadout.fragments)
            ? "the fragments are not as planned"
            : null,
        ].filter((part) => part !== null)
  return [...pieces, ...subclass]
}
