import type {
  DamageType,
  EditBuild,
  ItemSlot,
  ItemSummary,
  PlanRow,
  SavedBuild,
} from '@ghost/contract'

export const GEAR_SLOTS = [
  'kinetic',
  'energy',
  'power',
  'helmet',
  'arms',
  'chest',
  'legs',
  'class',
] as const satisfies readonly ItemSlot[]

export type GearSlot = (typeof GEAR_SLOTS)[number]

export interface Gear {
  readonly id: string
  readonly name: string
  readonly icon: string | null
  readonly element: DamageType
  readonly gearTier: number | null
  readonly masterwork: boolean
  readonly power: number | null
}

export interface BuildDraft {
  readonly name: string
  readonly purpose: string
  readonly gear: Readonly<Record<GearSlot, Gear | null>>
  /** Kept items the editor can't place in a slot; sent back untouched. */
  readonly unplaced: readonly string[]
}

const gearSlot = (slot: ItemSlot | undefined): GearSlot | undefined =>
  GEAR_SLOTS.find((each) => each === slot)

const emptyGear = (): Record<GearSlot, Gear | null> => ({
  kinetic: null,
  energy: null,
  power: null,
  helmet: null,
  arms: null,
  chest: null,
  legs: null,
  class: null,
})

const gearOfRow = (row: PlanRow): Gear => ({
  id: row.itemInstanceId,
  name: row.name,
  icon: row.icon,
  element: row.damageType ?? 'none',
  gearTier: row.gearTier ?? null,
  masterwork: row.masterwork ?? false,
  power: row.power,
})

export const gearOfItem = (item: ItemSummary & { itemInstanceId: string }): Gear => ({
  id: item.itemInstanceId,
  name: item.name,
  icon: item.icon,
  element: item.damageType,
  gearTier: item.gearTier ?? null,
  masterwork: item.masterwork,
  power: item.power,
})

const kept = (row: PlanRow) => row.action === 'equip' || row.action === 'none'

export const draftOf = (build: SavedBuild): BuildDraft => {
  const gear = emptyGear()
  const unplaced: string[] = []
  for (const row of build.plan.rows.filter(kept)) {
    const slot = gearSlot(row.slot)
    if (slot && gear[slot] === null) gear[slot] = gearOfRow(row)
    else unplaced.push(row.itemInstanceId)
  }
  return { name: build.name, purpose: build.plan.purpose ?? '', gear, unplaced }
}

export const editOf = (draft: BuildDraft): EditBuild => {
  const purpose = draft.purpose.trim()
  return {
    name: draft.name.trim(),
    purpose: purpose.length > 0 ? purpose : null,
    items: [
      ...draft.unplaced,
      ...GEAR_SLOTS.flatMap((slot) => {
        const gear = draft.gear[slot]
        return gear ? [gear.id] : []
      }),
    ],
  }
}

export const sameEdit = (a: EditBuild, b: EditBuild) =>
  a.name === b.name &&
  a.purpose === b.purpose &&
  a.items.length === b.items.length &&
  a.items.every((id) => b.items.includes(id))
