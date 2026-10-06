import type { LoadoutSlots } from "@ghost/contract"

export interface SlotChoice {
  readonly index: number
  readonly nameHash: number
  readonly colorHash: number
  readonly iconHash: number
}

/**
 * The in-game slot and look to save into: whatever the player picked, else the
 * slot this build already holds, else the first empty slot. A filled slot keeps
 * its name, color and icon until the player changes them; an empty one starts
 * on the first of each. Undefined while the game offers nothing to pick.
 */
export const slotChoice = (
  slots: LoadoutSlots,
  picked: Partial<SlotChoice>,
  holds: number | undefined,
): SlotChoice | undefined => {
  const index =
    picked.index ?? holds ?? (slots.slots.find((slot) => slot.empty) ?? slots.slots[0])?.index
  const slot = slots.slots.find((each) => each.index === index)
  const nameHash = picked.nameHash ?? slot?.name?.hash ?? slots.names[0]?.hash
  const colorHash = picked.colorHash ?? slot?.color?.hash ?? slots.colors[0]?.hash
  const iconHash = picked.iconHash ?? slot?.icon?.hash ?? slots.icons[0]?.hash
  if (
    index === undefined ||
    nameHash === undefined ||
    colorHash === undefined ||
    iconHash === undefined
  )
    return undefined
  return { index, nameHash, colorHash, iconHash }
}
