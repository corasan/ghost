import { ArmorMod, StatMod } from "@ghost/contract"
import { type OwnedItem, STAT } from "./inventory.ts"
import {
  type ArmorModEntry,
  BUILD_SOCKET,
  type ManifestItem,
  type PlugFacts,
  type StatFacts,
  type StatMods,
} from "./manifest.ts"
import { ARMOR_STATS, statLabel } from "./masterwork.ts"

// Armor mods on a build: reading what is slotted, and checking the swaps the
// agent asks for against the piece's sockets and energy before the player
// ever sees them, so a card never promises a mod that cannot go in.

type Piece = Pick<OwnedItem, "name" | "modSockets" | "energy">

/** One mod socket of a piece as it is now. */
export interface SocketNow {
  readonly index: number
  readonly plugHash: number
  /** Empty when Bungie could not be asked about the plug. */
  readonly category: string
  readonly mod: {
    readonly name: string
    readonly icon: string | null
    readonly description: string
    readonly cost: number
    readonly mods: StatMods
  } | null
}

export const socketsNow = (
  item: Pick<OwnedItem, "modSockets">,
  defs: ReadonlyMap<number, ManifestItem>,
  plugs: ReadonlyMap<number, PlugFacts>,
): ReadonlyArray<SocketNow> =>
  item.modSockets.map((socket) => {
    const def = defs.get(socket.plugHash)
    const known = plugs.get(socket.plugHash)
    return {
      index: socket.index,
      plugHash: socket.plugHash,
      category: known?.category ?? "",
      mod:
        socket.empty || def === undefined
          ? null
          : {
              name: def.name,
              icon: def.icon,
              description: def.description || (known?.description ?? ""),
              cost: known?.energyCost ?? 0,
              mods: known?.mods ?? {},
            },
    }
  })

/** A socket the plan fills, with what it held before. */
export interface ModSwap {
  readonly socket: SocketNow
  readonly entry: ArmorModEntry
}

export interface ModRequest {
  readonly mod: string
  readonly replaces?: string | undefined
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Turns the mods the agent wants on a piece into socket swaps, or says why
 * one cannot go in: no such mod for this slot, no free socket, or not enough
 * energy. Requests are placed in order, each seeing the ones before it.
 */
export const planModSwaps = ({
  item,
  sockets,
  catalog,
  requests,
}: {
  readonly item: Piece
  readonly sockets: ReadonlyArray<SocketNow>
  readonly catalog: ReadonlyArray<ArmorModEntry>
  readonly requests: ReadonlyArray<ModRequest>
}): { readonly swaps: ReadonlyArray<ModSwap>; readonly errors: ReadonlyArray<string> } => {
  const fits = new Set(sockets.map((socket) => socket.category).filter((c) => BUILD_SOCKET.test(c)))
  const taken = new Map<number, ArmorModEntry>()
  const swaps: Array<ModSwap> = []
  const errors: Array<string> = []
  let used = item.energy?.used ?? 0
  const capacity = item.energy?.capacity ?? 0
  const holds = (socket: SocketNow) => taken.get(socket.index)?.name ?? socket.mod?.name ?? null
  const costOf = (socket: SocketNow) => taken.get(socket.index)?.energyCost ?? socket.mod?.cost ?? 0

  for (const request of requests) {
    const candidates = catalog.filter(
      (entry) => same(entry.name, request.mod) && fits.has(entry.category),
    )
    const entry = candidates.find((candidate) => !candidate.artifact) ?? candidates[0]
    if (entry === undefined) {
      errors.push(`"${request.mod}" is not a mod that fits ${item.name}; check list_armor_mods`)
      continue
    }
    const open = sockets.filter((socket) => socket.category === entry.category)
    const target =
      request.replaces === undefined
        ? open.find((socket) => holds(socket) === null)
        : open.find((socket) => same(holds(socket) ?? "", request.replaces ?? ""))
    if (target === undefined) {
      errors.push(
        request.replaces === undefined
          ? `${item.name} has no free socket for "${entry.name}"; say which mod it replaces`
          : `${item.name} has no "${request.replaces}" where "${entry.name}" could go`,
      )
      continue
    }
    const after = used - costOf(target) + entry.energyCost
    if (after > capacity) {
      errors.push(
        `"${entry.name}" costs ${entry.energyCost} and would put ${item.name} at ${after} of ${capacity} energy`,
      )
      continue
    }
    used = after
    taken.set(target.index, entry)
    const earlier = swaps.findIndex((swap) => swap.socket.index === target.index)
    if (earlier >= 0) swaps.splice(earlier, 1)
    swaps.push({ socket: target, entry })
  }
  return { swaps, errors }
}

const statMods = (mods: StatMods, facts: StatFacts) =>
  ARMOR_STATS.flatMap(([key, label]) => {
    const delta = mods[STAT[key]]
    return delta === undefined ? [] : [new StatMod({ label: statLabel(key, label, facts), delta })]
  })

/** A piece's mods as the card shows them: every filled socket after the plan's swaps, in socket order. */
export const describeArmorMods = ({
  sockets,
  swaps,
  facts,
}: {
  readonly sockets: ReadonlyArray<SocketNow>
  readonly swaps: ReadonlyArray<ModSwap>
  readonly facts: StatFacts
}): {
  readonly armorMods: ReadonlyArray<ArmorMod>
  readonly freeModSlots: number
  readonly energyUsed: number
} => {
  const incoming = new Map(swaps.map((swap) => [swap.socket.index, swap.entry]))
  const armorMods = sockets.flatMap((socket) => {
    const entry = incoming.get(socket.index)
    if (entry !== undefined) {
      return [
        new ArmorMod({
          name: entry.name,
          icon: entry.icon,
          description: entry.description,
          cost: entry.energyCost,
          mods: statMods(entry.mods, facts),
          swap: true,
          replaces: socket.mod?.name ?? null,
          socketIndex: socket.index,
          plugHash: entry.hash,
          previousPlugHash: socket.plugHash,
        }),
      ]
    }
    return socket.mod === null
      ? []
      : [
          new ArmorMod({
            name: socket.mod.name,
            icon: socket.mod.icon,
            description: socket.mod.description,
            cost: socket.mod.cost,
            mods: statMods(socket.mod.mods, facts),
          }),
        ]
  })
  return {
    armorMods,
    freeModSlots: sockets.filter(
      (socket) =>
        socket.mod === null && BUILD_SOCKET.test(socket.category) && !incoming.has(socket.index),
    ).length,
    energyUsed: armorMods.reduce((sum, mod) => sum + mod.cost, 0),
  }
}

/** What the plan's swaps do to each armor stat, keyed by stat hash. */
export const swapStatChange = (swaps: ReadonlyArray<ModSwap>): StatMods => {
  const change: Record<string, number> = {}
  for (const swap of swaps) {
    for (const [stat, delta] of Object.entries(swap.entry.mods))
      change[stat] = (change[stat] ?? 0) + delta
    for (const [stat, delta] of Object.entries(swap.socket.mod?.mods ?? {}))
      change[stat] = (change[stat] ?? 0) - delta
  }
  return change
}
