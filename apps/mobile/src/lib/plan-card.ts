import type {
  GuardianClass,
  ItemSlot,
  Plan,
  SubclassLoadout,
  PlanRow,
  StatMod,
} from "@ghost/contract"

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

const totals = (lists: readonly (readonly StatMod[])[]): StatMod[] => {
  const sums = new Map<string, number>()
  for (const mods of lists) {
    for (const mod of mods) sums.set(mod.label, (sums.get(mod.label) ?? 0) + mod.delta)
  }
  return [...sums]
    .filter(([, delta]) => delta !== 0)
    .map(([label, delta]) => ({ label, delta }))
    .sort((a, b) => b.delta - a.delta)
}

/** What the slotted fragments add up to per stat, gains first; stats that net to zero are left out. */
export const fragmentTotals = (loadout: SubclassLoadout): StatMod[] =>
  totals(loadout.fragments.map((fragment) => fragment.mods))

/** What fragments and armor mods together add to the build's stats. */
export const appliedTotals = (plan: Plan): StatMod[] =>
  totals([
    ...(plan.loadout?.fragments ?? []).map((fragment) => fragment.mods),
    ...plan.rows.flatMap((row) => (row.armorMods ?? []).map((mod) => mod.mods)),
  ])

export const hasStatMods = (plan: Plan) =>
  plan.rows.some((row) => row.armorMods?.some((mod) => mod.mods.length > 0))

const SHORT_STAT: Record<string, string> = {
  HEALTH: "HLT",
  MELEE: "MEL",
  GRENADE: "GRN",
  SUPER: "SUP",
  CLASS: "CLS",
  WEAPONS: "WPN",
}

export const shortStat = (label: string) => SHORT_STAT[label] ?? label.slice(0, 3)

export type ModPip = "swap" | "stat" | "other" | "free"

/** One pip per mod socket: a mod the plan puts in, a stat mod, any other mod, or a free slot. Undefined when the plan predates mods. */
export const modPips = (row: PlanRow): ModPip[] | undefined =>
  row.armorMods === undefined
    ? undefined
    : [
        ...row.armorMods.map((mod): ModPip =>
          mod.swap ? "swap" : mod.mods.length > 0 ? "stat" : "other",
        ),
        ...Array.from({ length: row.freeModSlots ?? 0 }, (): ModPip => "free"),
      ]

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

export const modSwaps = (plan: Plan) =>
  plan.rows.reduce(
    (count, row) => count + (row.armorMods?.filter((mod) => mod.swap).length ?? 0),
    0,
  )

const modsChange = (count: number) => `${count} ${count === 1 ? "mod changes" : "mods change"}`

/**
 * The one line under the tiles: what confirming will do. `plain` reads in the
 * body colour and `change` in blue, so moves and mod swaps stand out.
 */
export const verdict = (plan: Plan): { plain: string; change: string } => {
  const acting = plan.rows.filter((row) => row.action !== "none")
  const moving = acting.filter((row) => row.origin !== undefined).length
  const mods = modSwaps(plan)
  if (moving > 0) {
    const pieces = `${moving} ${moving === 1 ? "piece moves" : "pieces move"}`
    return { plain: "", change: mods > 0 ? `${pieces}, ${modsChange(mods)}.` : `${pieces}.` }
  }
  const plain = acting.length > 0 ? `${acting.length} to equip.` : "Nothing moves."
  return { plain, change: mods > 0 ? `${modsChange(mods)}.` : "" }
}
