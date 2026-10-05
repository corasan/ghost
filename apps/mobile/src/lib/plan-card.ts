import type { GuardianClass, ItemSlot, Plan, PlanLoadout, PlanRow, StatMod } from "@ghost/contract"

/** "MOVE 8 TO VAULT" follows the ticks: the first number tracks the selection. */
export const liveLabel = (label: string, count: number) =>
  /\d+/.test(label) ? label.replace(/\d+/, String(count)) : label

export const headline = (plan: Plan) => {
  const wanted = plan.stats.filter((stat) => stat.target).map((stat) => stat.label)
  return (wanted.length > 0 ? wanted.join(" + ") : (plan.subtitle ?? plan.title)).toUpperCase()
}

const POINTS_PER_TICK = 20
export const STAT_TICKS = 10

export const litTicks = (value: number) =>
  Math.max(0, Math.min(STAT_TICKS, Math.floor(value / POINTS_PER_TICK)))

/** What the slotted fragments add up to per stat, gains first; stats that net to zero are left out. */
export const fragmentTotals = (loadout: PlanLoadout): StatMod[] => {
  const totals = new Map<string, number>()
  for (const fragment of loadout.fragments) {
    for (const mod of fragment.mods) totals.set(mod.label, (totals.get(mod.label) ?? 0) + mod.delta)
  }
  return [...totals]
    .filter(([, delta]) => delta !== 0)
    .map(([label, delta]) => ({ label, delta }))
    .sort((a, b) => b.delta - a.delta)
}

export const signed = (delta: number) => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`)

/** "Ember of Searing" reads as "Searing" where the fragments share a line. */
export const shortPlugName = (name: string) => name.replace(/^\S+ of /, "")

const CLASS_ITEM: Record<GuardianClass, string> = {
  titan: "MARK",
  hunter: "CLOAK",
  warlock: "BOND",
}

const SLOT_LABEL: Record<ItemSlot, string> = {
  helmet: "HELM",
  arms: "ARMS",
  chest: "CHEST",
  legs: "LEGS",
  class: "CLASS",
  kinetic: "KINETIC",
  energy: "ENERGY",
  power: "POWER",
  other: "",
}

export const slotLabel = (slot: ItemSlot | undefined, classType: GuardianClass | undefined) =>
  slot === undefined
    ? ""
    : slot === "class" && classType !== undefined
      ? CLASS_ITEM[classType]
      : SLOT_LABEL[slot]

const SLOT_ORDER = Object.keys(SLOT_LABEL)

/** Head to toe, then weapons; rows from before plans carried a slot keep their place. */
export const bySlot = (rows: readonly PlanRow[]): PlanRow[] =>
  rows.every((row) => row.slot !== undefined)
    ? [...rows].sort(
        (a, b) => SLOT_ORDER.indexOf(a.slot as ItemSlot) - SLOT_ORDER.indexOf(b.slot as ItemSlot),
      )
    : [...rows]

export const pendingMasterwork = (plan: Plan) =>
  plan.rows.filter((row) => row.stats?.some((stat) => stat.masterworked !== undefined)).length

/** The one line under the tiles: what confirming will do. */
export const verdict = (plan: Plan): { text: string; moves: boolean } => {
  const acting = plan.rows.filter((row) => row.action !== "none")
  const moving = acting.filter((row) => row.origin !== undefined).length
  if (moving > 0)
    return { text: `${moving} ${moving === 1 ? "piece moves" : "pieces move"}.`, moves: true }
  if (acting.length > 0) return { text: `${acting.length} to equip.`, moves: false }
  return { text: "Nothing moves.", moves: false }
}
