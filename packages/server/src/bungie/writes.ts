import type { Profile, RawItem } from './inventory.ts'
import { BUCKETS, type ManifestItem } from './manifest.ts'

/**
 * A change Bungie confirmed. GetProfile can keep answering with the profile
 * from before it for over a minute, so each profile read has these laid over it.
 * `to` is a character id, or null for the vault.
 */
export type ProfileWrite =
  | { readonly kind: 'move'; readonly itemId: string; readonly to: string | null }
  | { readonly kind: 'equip'; readonly itemId: string; readonly characterId: string }
  | {
      readonly kind: 'plug'
      readonly itemId: string
      readonly socketIndex: number
      readonly plugHash: number
    }

export type TimedWrite = ProfileWrite & { readonly at: number }

export const reconcile = (
  profile: Profile,
  writes: ReadonlyArray<ProfileWrite>,
  defs: ReadonlyMap<number, ManifestItem>,
): Profile => {
  if (writes.length === 0) return profile
  let vault = [...(profile.profileInventory?.data?.items ?? [])]
  const lists = (data: Readonly<Record<string, { readonly items: ReadonlyArray<RawItem> }>>) =>
    new Map(Object.entries(data).map(([id, list]) => [id, [...list.items]]))
  const inventories = lists(profile.characterInventories?.data ?? {})
  const equipment = lists(profile.characterEquipment?.data ?? {})
  const sockets = new Map(
    Object.entries(profile.itemComponents?.sockets?.data ?? {}).map(([id, entry]) => [
      id,
      entry.sockets,
    ]),
  )

  const holds = (list: ReadonlyArray<RawItem> | undefined, itemId: string) =>
    list?.some((raw) => raw.itemInstanceId === itemId) ?? false
  const find = (itemId: string) =>
    [vault, ...inventories.values(), ...equipment.values()]
      .flat()
      .find((raw) => raw.itemInstanceId === itemId)
  const take = (itemId: string) => {
    const keep = (list: Array<RawItem>) => list.filter((raw) => raw.itemInstanceId !== itemId)
    vault = keep(vault)
    for (const [id, list] of inventories) inventories.set(id, keep(list))
    for (const [id, list] of equipment) equipment.set(id, keep(list))
  }

  for (const write of writes) {
    const raw = find(write.itemId)
    if (raw === undefined) continue
    switch (write.kind) {
      case 'move': {
        if (write.to === null) {
          if (holds(vault, write.itemId)) break
          take(write.itemId)
          vault.push({ ...raw, bucketHash: BUCKETS.vault })
          break
        }
        const inventory = inventories.get(write.to)
        const bucketHash = defs.get(raw.itemHash)?.bucketHash
        if (inventory === undefined || bucketHash === undefined) break
        if (holds(equipment.get(write.to), write.itemId)) break
        if (holds(inventory, write.itemId) && raw.bucketHash !== BUCKETS.postmaster) break
        take(write.itemId)
        inventories.get(write.to)?.push({ ...raw, bucketHash })
        break
      }
      case 'equip': {
        const worn = equipment.get(write.characterId)
        if (worn === undefined || holds(worn, write.itemId)) break
        const carried =
          holds(inventories.get(write.characterId), write.itemId) &&
          raw.bucketHash !== BUCKETS.postmaster
        const bucketHash = carried ? raw.bucketHash : defs.get(raw.itemHash)?.bucketHash
        if (bucketHash === undefined) break
        take(write.itemId)
        const previous = worn.find((each) => each.bucketHash === bucketHash)
        equipment.set(write.characterId, [
          ...worn.filter((each) => each !== previous),
          { ...raw, bucketHash },
        ])
        if (previous !== undefined) inventories.get(write.characterId)?.push(previous)
        break
      }
      case 'plug': {
        const current = sockets.get(write.itemId)
        if (current?.[write.socketIndex] === undefined) break
        sockets.set(
          write.itemId,
          current.map((socket, index) =>
            index === write.socketIndex ? { ...socket, plugHash: write.plugHash } : socket,
          ),
        )
        break
      }
    }
  }

  const records = (map: Map<string, Array<RawItem>>) =>
    Object.fromEntries([...map].map(([id, items]) => [id, { items }]))
  return {
    ...profile,
    profileInventory: { ...profile.profileInventory, data: { items: vault } },
    characterInventories: { ...profile.characterInventories, data: records(inventories) },
    characterEquipment: { ...profile.characterEquipment, data: records(equipment) },
    itemComponents: {
      ...profile.itemComponents,
      sockets: {
        ...profile.itemComponents?.sockets,
        data: Object.fromEntries([...sockets].map(([id, list]) => [id, { sockets: list }])),
      },
    },
  }
}
