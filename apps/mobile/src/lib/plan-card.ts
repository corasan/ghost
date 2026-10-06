import {
  type GuardianClass,
  type ItemSlot,
  type LoadoutSaveTo,
  OFF_BUILD_FIT,
  type Plan,
  type SubclassLoadout,
  type PlanRow,
  type SetBonus,
  type StatMod,
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

const fill = (points: number, tick: number) =>
  Math.max(0, Math.min(1, (points - tick * POINTS_PER_TICK) / POINTS_PER_TICK))

export type StatTick = { base: number; added: number }

/** How full each tick is, split into the stat without fragments and mods and the part they add. */
export const statTicks = (value: number, added: number): StatTick[] =>
  Array.from({ length: STAT_TICKS }, (_, tick) => {
    const base = fill(value - Math.max(0, added), tick)
    return { base, added: fill(value, tick) - base }
  })

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
  titan: "Mark",
  hunter: "Cloak",
  warlock: "Bond",
}

const SLOT_LABEL: Record<ItemSlot, string> = {
  helmet: "Helm",
  arms: "Arms",
  chest: "Chest",
  legs: "Legs",
  class: "Class",
  kinetic: "Kinetic",
  energy: "Energy",
  power: "Power",
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

const WEAPON_SLOTS: ReadonlySet<ItemSlot | undefined> = new Set<ItemSlot>([
  "kinetic",
  "energy",
  "power",
])

export const isWeaponRow = (row: PlanRow) => WEAPON_SLOTS.has(row.slot)

export const splitRows = (rows: readonly PlanRow[]) => {
  const sorted = bySlot(rows)
  return {
    pieces: sorted.filter((row) => !isWeaponRow(row)),
    weapons: sorted.filter(isWeaponRow),
  }
}

export type SaveToLine = { text: string; tone: "plan" | "ok" | "held" | "failed" }

export const saveToLine = (saveTo: LoadoutSaveTo): SaveToLine => {
  const slot = `slot ${saveTo.index + 1}`
  switch (saveTo.outcome) {
    case null:
      return {
        tone: "plan",
        text: saveTo.replaces
          ? `Saves to ${slot} in game, replacing ${saveTo.replaces}.`
          : `Saves to ${slot} in game.`,
      }
    case "ok":
      return { tone: "ok", text: `Saved to ${slot} in game.` }
    case "skipped":
      return {
        tone: "held",
        text: `Not saved to ${slot}: ${saveTo.error ?? "the build did not end up equipped as planned"}.`,
      }
    case "failed":
      return {
        tone: "failed",
        text: `Saving to ${slot} failed: ${saveTo.error ?? "Bungie refused it"}.`,
      }
  }
}

export const pendingMasterwork = (plan: Plan) =>
  plan.rows.filter((row) => row.stats?.some((stat) => stat.masterworked !== undefined)).length

export const modSwaps = (plan: Plan) =>
  plan.rows.reduce(
    (count, row) => count + (row.armorMods?.filter((mod) => mod.swap).length ?? 0),
    0,
  )

export const failures = (plan: Plan) =>
  plan.rows.filter((row) => row.outcome === "failed").length +
  (plan.loadout?.change?.outcome === "failed" ? 1 : 0)

export type Tally = { readonly count: number; readonly label: string; readonly inGame?: true }

export const tallies = (plan: Plan): ReadonlyArray<Tally> => {
  const acting = plan.rows.filter((row) => row.action !== "none")
  const moving = acting.filter((row) => row.origin !== undefined).length
  const change = plan.loadout?.change
  const subclass = change === undefined ? 0 : change.replaces !== null ? 1 : change.swaps.length
  const toSelect =
    plan.artifact?.picks.filter((pick) => pick.state === "select_in_game").length ?? 0
  return [
    { count: moving > 0 ? moving : acting.length, label: moving > 0 ? "move" : "equip" },
    {
      count: subclass,
      label: change?.replaces === null ? (subclass === 1 ? "plug" : "plugs") : "subclass",
    },
    { count: modSwaps(plan), label: "mods" },
    { count: toSelect, label: "in game", inGame: true as const },
  ].filter((tally) => tally.count > 0)
}

const piecesAway = (bonus: SetBonus) => Math.max(0, bonus.required - bonus.worn)

/** "2-PIECE · TECHSEC", then "1 PIECE AWAY" while the build is short of it. */
export const setBonusLine = (bonus: SetBonus) => {
  const away = piecesAway(bonus)
  return [
    `${bonus.required}-piece`,
    bonus.set,
    away > 0 ? `${away} ${away === 1 ? "piece" : "pieces"} away` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ")
}

/** A build's set bonuses: the ones its pieces turn on, then the ones it is short of. */
export type SetBonusSplit = { on: readonly SetBonus[]; short: readonly SetBonus[] }

export const splitSetBonuses = (bonuses: readonly SetBonus[]): SetBonusSplit => ({
  on: bonuses.filter((bonus) => piecesAway(bonus) === 0),
  short: bonuses.filter((bonus) => piecesAway(bonus) > 0),
})

/** The armor set a piece belongs to: how many of its pieces are worn, out of the most any bonus needs. */
export type ArmorSet = {
  name: string
  worn: number
  of: number
  bonuses: readonly { bonus: SetBonus; on: boolean }[]
}

export const armorSet = (bonuses: readonly SetBonus[] | undefined): ArmorSet | undefined => {
  const first = bonuses?.[0]
  if (!bonuses || !first) return undefined
  return {
    name: first.set,
    worn: Math.max(...bonuses.map((bonus) => bonus.worn)),
    of: Math.max(...bonuses.map((bonus) => bonus.required)),
    bonuses: [...bonuses]
      .sort((a, b) => a.required - b.required)
      .map((bonus) => ({ bonus, on: piecesAway(bonus) === 0 })),
  }
}

/** An active bonus, flagged when Jev judged it a poor fit for the build. */
export type ActiveBonus = { bonus: SetBonus; offBuild: boolean }

export type SynergyPart =
  | { kind: "exotic"; row: PlanRow; text: string }
  | {
      kind: "setBonuses"
      on: readonly ActiveBonus[]
      short: readonly SetBonus[]
      text: string | undefined
    }
  | { kind: "mods"; text: string }
  | { kind: "weapons"; exotic: PlanRow | undefined; text: string }
  | { kind: "artifact"; text: string }

const ARMOR_SLOTS: ReadonlySet<ItemSlot | undefined> = new Set<ItemSlot>([
  "helmet",
  "arms",
  "chest",
  "legs",
  "class",
])

export const synergyParts = (plan: Plan): SynergyPart[] => {
  const { exotic, setBonuses: setText, mods, weapons, artifact } = plan.synergy ?? {}
  const exoticRow = plan.rows.find((row) => row.tier === "exotic" && ARMOR_SLOTS.has(row.slot))
  const bonuses = plan.setBonuses ?? []
  const parts: SynergyPart[] = []
  if (exoticRow && exotic) parts.push({ kind: "exotic", row: exoticRow, text: exotic })
  if (weapons) {
    const exoticWeapon = plan.rows.find((row) => row.tier === "exotic" && isWeaponRow(row))
    parts.push({ kind: "weapons", exotic: exoticWeapon, text: weapons })
  }
  if (bonuses.length > 0 || setText) {
    const { on, short } = splitSetBonuses(bonuses)
    parts.push({
      kind: "setBonuses",
      on: on.map((bonus) => ({ bonus, offBuild: (bonus.fit ?? 1) < OFF_BUILD_FIT })),
      short,
      text: setText,
    })
  }
  if (mods) parts.push({ kind: "mods", text: mods })
  if (artifact) parts.push({ kind: "artifact", text: artifact })
  return parts
}
