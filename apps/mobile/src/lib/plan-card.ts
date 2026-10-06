import type {
  GuardianClass,
  ItemSlot,
  Plan,
  SubclassLoadout,
  PlanRow,
  SetBonus,
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

const SHORT_STAT = new Map([
  ["HEALTH", "HLT"],
  ["MELEE", "MEL"],
  ["GRENADE", "GRN"],
  ["SUPER", "SUP"],
  ["CLASS", "CLS"],
  ["WEAPONS", "WPN"],
])

export const shortStat = (label: string) => SHORT_STAT.get(label) ?? label.slice(0, 3)

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

const slotRank = (row: PlanRow) => (row.slot === undefined ? -1 : SLOT_ORDER.indexOf(row.slot))

/** Head to toe, then weapons; rows from before plans carried a slot keep their place. */
export const bySlot = (rows: readonly PlanRow[]): PlanRow[] =>
  rows.every((row) => row.slot !== undefined)
    ? [...rows].sort((a, b) => slotRank(a) - slotRank(b))
    : [...rows]

export const pendingMasterwork = (plan: Plan) =>
  plan.rows.filter((row) => row.stats?.some((stat) => stat.masterworked !== undefined)).length

export const modSwaps = (plan: Plan) =>
  plan.rows.reduce(
    (count, row) => count + (row.armorMods?.filter((mod) => mod.swap).length ?? 0),
    0,
  )

const modsChange = (count: number) => `${count} ${count === 1 ? "mod changes" : "mods change"}`

/** What confirming does to the subclass: switching to it, or how many of its plugs change. */
export const subclassChange = (plan: Plan): string | null => {
  const change = plan.loadout?.change
  if (change === undefined) return null
  if (change.replaces !== null) return `Switches to ${plan.loadout?.subclass ?? "the subclass"}`
  const plugs = change.swaps.length
  return plugs === 0 ? null : `${plugs} subclass ${plugs === 1 ? "plug changes" : "plugs change"}`
}

/** Rows and the subclass change that failed when the plan ran. */
export const failures = (plan: Plan) =>
  plan.rows.filter((row) => row.outcome === "failed").length +
  (plan.loadout?.change?.outcome === "failed" ? 1 : 0)

/**
 * The one line under the tiles: what confirming will do. `plain` reads in the
 * body colour and `change` in blue, so moves, the subclass and mod swaps stand out.
 */
export const verdict = (plan: Plan) => {
  const acting = plan.rows.filter((row) => row.action !== "none")
  const moving = acting.filter((row) => row.origin !== undefined).length
  const mods = modSwaps(plan)
  const changes = [
    moving > 0 ? `${moving} ${moving === 1 ? "piece moves" : "pieces move"}` : null,
    subclassChange(plan),
    mods > 0 ? modsChange(mods) : null,
  ].filter((part) => part !== null)
  const plain =
    moving > 0 ? "" : acting.length > 0 ? `${acting.length} to equip.` : "Nothing moves."
  return { plain, change: changes.length > 0 ? `${changes.join(", ")}.` : "" }
}

/** "2-PIECE · TECHSEC" */
export const setBonusLine = (bonus: SetBonus) =>
  `${bonus.required}-PIECE · ${bonus.set}`.toUpperCase()

export type SynergyPart =
  | { kind: "exotic"; row: PlanRow; text: string }
  | { kind: "setBonuses"; bonuses: readonly SetBonus[]; text: string | undefined }
  | { kind: "mods"; text: string }

const ARMOR_SLOTS: ReadonlySet<ItemSlot | undefined> = new Set<ItemSlot>([
  "helmet",
  "arms",
  "chest",
  "legs",
  "class",
])

/**
 * How the exotic armor, the set bonuses and the mods feed the build, in that
 * order. A part needs Ghost's words, except active set bonuses, which show without them.
 */
export const synergyParts = (plan: Plan): SynergyPart[] => {
  const { exotic, setBonuses: setText, mods } = plan.synergy ?? {}
  const exoticRow = plan.rows.find((row) => row.tier === "exotic" && ARMOR_SLOTS.has(row.slot))
  const bonuses = plan.setBonuses ?? []
  const parts: SynergyPart[] = []
  if (exoticRow && exotic) parts.push({ kind: "exotic", row: exoticRow, text: exotic })
  if (bonuses.length > 0 || setText) parts.push({ kind: "setBonuses", bonuses, text: setText })
  if (mods) parts.push({ kind: "mods", text: mods })
  return parts
}
