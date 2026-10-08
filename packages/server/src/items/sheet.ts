import { PerkColumn, StatChange, WeaponPerk, WeaponSheet, WeaponStat } from "@ghost/contract"
import type { OwnedItem } from "../bungie/inventory.ts"
import type { ManifestItem, PerkPool, StatMods } from "../bungie/manifest.ts"
import type { RatedColumns } from "../junk/perks.ts"

const WEAPON_STATS: ReadonlyArray<{
  readonly hash: string
  readonly name: string
  readonly bar: boolean
}> = [
  { hash: "4043523819", name: "Impact", bar: true },
  { hash: "3614673599", name: "Blast Radius", bar: true },
  { hash: "2523465841", name: "Velocity", bar: true },
  { hash: "2837207746", name: "Swing Speed", bar: true },
  { hash: "1240592695", name: "Range", bar: true },
  { hash: "1591432999", name: "Accuracy", bar: true },
  { hash: "155624089", name: "Stability", bar: true },
  { hash: "943549884", name: "Handling", bar: true },
  { hash: "4188031367", name: "Reload Speed", bar: true },
  { hash: "3022301683", name: "Charge Rate", bar: true },
  { hash: "2762071195", name: "Guard Efficiency", bar: true },
  { hash: "209426660", name: "Guard Resistance", bar: true },
  { hash: "3736848092", name: "Guard Endurance", bar: true },
  { hash: "1842278586", name: "Shield Duration", bar: true },
  { hash: "1345609583", name: "Aim Assistance", bar: true },
  { hash: "2714457168", name: "Airborne", bar: true },
  { hash: "4284893193", name: "RPM", bar: false },
  { hash: "447667954", name: "Draw Time", bar: false },
  { hash: "2961396640", name: "Charge Time", bar: false },
  { hash: "3871231066", name: "Mag", bar: false },
  { hash: "925767036", name: "Ammo", bar: false },
  { hash: "3555269338", name: "Zoom", bar: false },
  { hash: "2715839340", name: "Recoil", bar: false },
]

const STAT_NAMES = new Map(WEAPON_STATS.map((stat) => [stat.hash, stat.name]))

export interface PoolPlug {
  readonly plug: ManifestItem
  readonly active: boolean
  readonly rolled: boolean
}

export interface PoolColumn {
  readonly label: string
  readonly socketIndex: number
  readonly plugs: ReadonlyArray<PoolPlug>
}

const baseType = (plug: ManifestItem) => plug.typeName.replace(/^Enhanced /, "")

const RANK = (plug: PoolPlug) => (plug.active ? 2 : plug.rolled ? 1 : 0)

/**
 * The weapon's perk sockets, each with every perk it can roll plus whatever
 * this copy holds there. A perk the copy has in its enhanced form stands in
 * for the plain one in the pool.
 */
export const poolColumns = (
  item: Pick<OwnedItem, "weaponSockets" | "weaponStats">,
  pools: ReadonlyArray<PerkPool>,
  defs: ReadonlyMap<number, ManifestItem>,
  isPerk: (plug: ManifestItem) => boolean,
): ReadonlyArray<PoolColumn> => {
  let traits = 0
  return pools.flatMap(({ index, pool }) => {
    const socket = item.weaponSockets.find((each) => each.index === index)
    const selected = socket === undefined ? undefined : defs.get(socket.plugHash)
    if (socket === undefined || selected === undefined || !isPerk(selected)) return []
    const rolled = new Set(socket.rolled)
    const byName = new Map<string, PoolPlug>()
    for (const hash of [...rolled, socket.plugHash, ...pool]) {
      const plug = defs.get(hash)
      if (plug === undefined || !isPerk(plug)) continue
      const entry = { plug, active: hash === socket.plugHash, rolled: rolled.has(hash) }
      const known = byName.get(plug.name)
      if (known === undefined || RANK(entry) > RANK(known)) byName.set(plug.name, entry)
    }
    const order = [...new Set([...pool, ...rolled, socket.plugHash])].flatMap((hash) => {
      const name = defs.get(hash)?.name
      return name === undefined ? [] : [name]
    })
    const type = baseType(selected)
    const label =
      type === "Trait"
        ? `TRAIT ${++traits}`
        : type === "Origin Trait"
          ? "ORIGIN"
          : type === "Magazine"
            ? "MAG"
            : (type.split(" ").at(-1) ?? type).toUpperCase()
    return [
      {
        label,
        socketIndex: index,
        plugs: [...new Set(order)].flatMap((name) => byName.get(name) ?? []),
      },
    ]
  })
}

const changesOf = (mods: StatMods | undefined, shown: Readonly<Record<string, number>>) =>
  Object.entries(mods ?? {}).flatMap(([hash, value]) => {
    const stat = STAT_NAMES.get(hash)
    return stat === undefined || shown[hash] === undefined ? [] : [new StatChange({ stat, value })]
  })

export const weaponSheet = (
  item: Pick<OwnedItem, "weaponSockets" | "weaponStats">,
  columns: ReadonlyArray<PoolColumn>,
  rated: RatedColumns,
  investments: ReadonlyMap<number, StatMods>,
  score: number | null,
): WeaponSheet => {
  const active = columns.flatMap((column) =>
    column.plugs.filter((each) => each.active).map((each) => investments.get(each.plug.hash)),
  )
  return new WeaponSheet({
    score,
    columns: columns.map(
      (column, index) =>
        new PerkColumn({
          label: column.label,
          socketIndex: column.socketIndex,
          perks: column.plugs.map(({ plug, active, rolled }) => {
            const rating = rated[index]?.find((each) => each.name === plug.name)
            return new WeaponPerk({
              name: plug.name,
              description: plug.description,
              icon: plug.icon,
              plugHash: plug.hash,
              enhanced: plug.typeName.startsWith("Enhanced "),
              active,
              rolled: active || rolled,
              stats: changesOf(investments.get(plug.hash), item.weaponStats),
              good: rating?.good ?? [],
              source: rating?.source ?? null,
            })
          }),
        }),
    ),
    stats: WEAPON_STATS.flatMap(({ hash, name, bar }) => {
      const value = item.weaponStats[hash]
      if (value === undefined) return []
      const fromPerks = active.reduce((sum, mods) => sum + (mods?.[hash] ?? 0), 0)
      return [
        new WeaponStat({ name, value, bar, fromPerks: Math.max(0, Math.min(value, fromPerks)) }),
      ]
    }),
  })
}
