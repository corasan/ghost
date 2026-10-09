import { Schema } from 'effect'
import {
  ABILITY_KINDS,
  isEmptyPlug,
  type OwnedSubclass,
  type SlottedPlugs,
  type SubclassPart,
  type SubclassPlug,
  subclassPart,
} from './inventory.ts'
import type { ManifestItem } from './manifest.ts'

const PlugSetEntries = Schema.Record(
  Schema.String,
  Schema.Array(
    Schema.Struct({
      plugItemHash: Schema.Number,
      canInsert: Schema.Boolean,
      enabled: Schema.Boolean,
    }),
  ),
)

/** Profile component 104: the plugs unlocked account-wide and per character. */
export const PlugSets = Schema.Struct({
  profilePlugSets: Schema.optional(
    Schema.Struct({ data: Schema.optional(Schema.Struct({ plugs: PlugSetEntries })) }),
  ),
  characterPlugSets: Schema.optional(
    Schema.Struct({
      data: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ plugs: PlugSetEntries }))),
    }),
  ),
})
export type PlugSets = typeof PlugSets.Type

/** The plugs of a plug set the character can put in. */
export const unlockedPlugs = (
  sets: PlugSets,
  characterId: string,
  setHash: number,
): ReadonlyArray<number> =>
  [
    ...(sets.profilePlugSets?.data?.plugs[setHash] ?? []),
    ...(sets.characterPlugSets?.data?.[characterId]?.plugs[setHash] ?? []),
  ].flatMap((entry) => (entry.canInsert && entry.enabled ? [entry.plugItemHash] : []))

export interface SubclassSocket {
  readonly index: number
  readonly part: SubclassPart
  readonly current: number
  readonly enabled: boolean
  /** What the socket can take, empty plug left out. */
  readonly options: ReadonlyArray<SubclassPlug>
}

const toPlug = ({ hash, name, description, icon }: ManifestItem): SubclassPlug => ({
  hash,
  name,
  description,
  icon,
})

/**
 * The sockets of an owned subclass a build can fill, in socket order. A socket
 * with no plug set (some supers) offers only what it holds.
 */
export const subclassSockets = ({
  subclass,
  plugSets,
  unlocked,
  defs,
}: {
  readonly subclass: Pick<OwnedSubclass, 'sockets'>
  readonly plugSets: ReadonlyArray<number | null>
  readonly unlocked: (setHash: number) => ReadonlyArray<number>
  readonly defs: ReadonlyMap<number, ManifestItem>
}): ReadonlyArray<SubclassSocket> =>
  subclass.sockets.flatMap((socket, index): Array<SubclassSocket> => {
    const set = plugSets[index] ?? null
    const pool = (set === null ? [socket.plugHash] : unlocked(set)).flatMap(
      (hash) => defs.get(hash) ?? [],
    )
    const filled = pool.filter((plug) => !isEmptyPlug(plug.name))
    const part = filled.map((plug) => subclassPart(plug.typeName)).find((found) => found !== null)
    if (part === undefined) return []
    return [
      {
        index,
        part,
        current: socket.plugHash,
        enabled: socket.enabled,
        options: filled.filter((plug) => subclassPart(plug.typeName) === part).map(toPlug),
      },
    ]
  })

/** The plugs the agent picks; anything left out stays as the subclass has it. */
export interface SubclassRequest {
  readonly super?: string | undefined
  readonly classAbility?: string | undefined
  readonly jump?: string | undefined
  readonly melee?: string | undefined
  readonly grenade?: string | undefined
  readonly aspects?: ReadonlyArray<string> | undefined
  readonly fragments?: ReadonlyArray<string> | undefined
}

/** A socket the build fills, with the plug it held. */
export interface PlugSwap {
  readonly socketIndex: number
  readonly plug: SubclassPlug
  readonly previousPlugHash: number
  /** Null when the socket was empty. */
  readonly previous: SubclassPlug | null
}

type SinglePick = Exclude<keyof SubclassRequest, 'aspects' | 'fragments'>

const SINGLE: ReadonlyArray<readonly [SubclassPart, SinglePick, string]> = [
  ['super', 'super', 'super'],
  ['class', 'classAbility', 'class ability'],
  ['jump', 'jump', 'jump'],
  ['melee', 'melee', 'melee'],
  ['grenade', 'grenade', 'grenade'],
]

const RANK: Record<SubclassPart, number> = {
  aspect: 0,
  fragment: 1,
  super: 2,
  class: 2,
  jump: 2,
  melee: 2,
  grenade: 2,
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Turns the agent's picks for one subclass into the plugs it ends up with and
 * the sockets that change, or says what is wrong: a plug that is not unlocked
 * for that socket, a repeat, more aspects than sockets, or more fragments than
 * the aspects give slots. Plugs already slotted stay in their socket, new ones
 * fill empty sockets first and then replace from the last socket back, and a
 * socket nothing new needs keeps what it holds. Fragments use only the first
 * sockets, since those are the ones the aspects open.
 */
export const planSubclass = ({
  name,
  sockets,
  request,
  defs,
  fragmentSlots,
}: {
  readonly name: string
  readonly sockets: ReadonlyArray<SubclassSocket>
  readonly request: SubclassRequest
  readonly defs: ReadonlyMap<number, ManifestItem>
  readonly fragmentSlots: (aspect: number) => number
}):
  | { readonly loadout: SlottedPlugs; readonly swaps: ReadonlyArray<PlugSwap> }
  | { readonly errors: ReadonlyArray<string> } => {
  const errors: Array<string> = []
  const final = new Map<number, number>()
  const plugOf = (hash: number): SubclassPlug | null => {
    const def = defs.get(hash)
    return def === undefined || isEmptyPlug(def.name) ? null : toPlug(def)
  }
  const of = (part: SubclassPart) => sockets.filter((socket) => socket.part === part)
  const resolve = (label: string, wanted: string, pool: ReadonlyArray<SubclassPlug>) => {
    const hit = pool.find((plug) => same(plug.name, wanted))
    if (hit === undefined) {
      errors.push(
        `"${wanted}" is not a ${label} unlocked on ${name}; pick from ${pool.map((plug) => plug.name).join(', ')}`,
      )
    }
    return hit?.hash
  }

  for (const [part, key, label] of SINGLE) {
    const wanted = request[key]
    const socket = of(part)[0]
    if (socket === undefined) {
      if (wanted !== undefined) errors.push(`${name} has no ${label} to change`)
      continue
    }
    const hash = wanted === undefined ? socket.current : resolve(label, wanted, socket.options)
    if (hash !== undefined) final.set(socket.index, hash)
  }

  const fill = (
    label: string,
    wanted: ReadonlyArray<string> | undefined,
    slotted: ReadonlyArray<SubclassSocket>,
    usable: ReadonlyArray<SubclassSocket>,
  ) => {
    const pool = [
      ...new Map(slotted.flatMap((socket) => socket.options).map((p) => [p.hash, p])).values(),
    ]
    const repeats = (wanted ?? []).filter(
      (each, i, all) => all.findIndex((other) => same(other, each)) !== i,
    )
    if (repeats.length > 0) errors.push(`${repeats.join(', ')} picked twice`)
    const hashes =
      wanted === undefined
        ? slotted.flatMap((socket) =>
            socket.enabled && plugOf(socket.current) !== null ? [socket.current] : [],
          )
        : wanted.flatMap((each) => resolve(label, each, pool) ?? [])
    if (hashes.length > usable.length) return hashes.length
    const left = hashes.filter((hash) => !usable.some((socket) => socket.current === hash))
    const free = usable.filter((socket) => !hashes.includes(socket.current))
    const targets = [
      ...free.filter((socket) => plugOf(socket.current) === null),
      ...free.filter((socket) => plugOf(socket.current) !== null).toReversed(),
    ]
    targets.forEach((socket, i) => {
      final.set(socket.index, left[i] ?? socket.current)
    })
    for (const socket of usable)
      if (!final.has(socket.index)) final.set(socket.index, socket.current)
    return hashes.length
  }

  const aspectSockets = of('aspect')
  const aspectCount = fill('aspect', request.aspects, aspectSockets, aspectSockets)
  if (aspectCount > aspectSockets.length) {
    errors.push(`${name} takes ${aspectSockets.length} aspects, not ${aspectCount}`)
  }
  const slots = aspectSockets.reduce(
    (sum, socket) => sum + fragmentSlots(final.get(socket.index) ?? socket.current),
    0,
  )
  const fragmentSockets = of('fragment')
  const open = fragmentSockets.slice(0, slots)
  const fragmentCount = fill('fragment', request.fragments, fragmentSockets, open)
  if (fragmentCount > open.length) {
    errors.push(
      request.fragments === undefined
        ? `the aspects give ${open.length} fragment slots but ${fragmentCount} fragments are slotted; pass the fragments to keep`
        : `the aspects give ${open.length} fragment slots, not ${fragmentCount}`,
    )
  }
  if (errors.length > 0) return { errors }
  const empty = (part: SubclassPart, within = of(part)) =>
    within.filter((socket) => plugOf(final.get(socket.index) ?? socket.current) === null).length
  if (empty('super') > 0) errors.push(`${name} would have no super; name one in super`)
  const noAspect = empty('aspect')
  if (noAspect > 0)
    errors.push(`${noAspect} aspect sockets on ${name} would be empty; name the aspects`)
  const noFragment = empty('fragment', open)
  if (noFragment > 0) {
    errors.push(
      `${noFragment} of ${open.length} fragment slots on ${name} would be empty; name the fragments`,
    )
  }
  if (errors.length > 0) return { errors }

  const swaps = sockets
    .filter((socket) => final.has(socket.index) && final.get(socket.index) !== socket.current)
    .toSorted((a, b) => RANK[a.part] - RANK[b.part] || a.index - b.index)
    .flatMap((socket): Array<PlugSwap> => {
      const hash = final.get(socket.index)
      const def = hash === undefined ? undefined : defs.get(hash)
      return def === undefined
        ? []
        : [
            {
              socketIndex: socket.index,
              plug: toPlug(def),
              previousPlugHash: socket.current,
              previous: plugOf(socket.current),
            },
          ]
    })
  const finalOf = (list: ReadonlyArray<SubclassSocket>) =>
    list.flatMap((socket) => plugOf(final.get(socket.index) ?? socket.current) ?? [])
  return {
    loadout: {
      super: finalOf(of('super'))[0] ?? null,
      abilities: ABILITY_KINDS.flatMap((kind) => {
        const plug = finalOf(of(kind))[0]
        return plug === undefined ? [] : [{ ...plug, kind }]
      }),
      aspects: finalOf(aspectSockets),
      fragments: finalOf(open),
    },
    swaps,
  }
}
