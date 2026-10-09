import type { ItemSummary } from '@ghost/contract'
import { View } from 'react-native'

import { ItemIcon } from '@/components/ghost/item-icon'
import { Cond, Meta } from '@/components/ghost/ui'
import { Ghost, Rarity } from '@/constants/theme'
import { useCharacter } from '@/lib/character'
import { sentence, upper } from '@/lib/format'

function useWhere(item: ItemSummary) {
  const { characters } = useCharacter()
  const owner = characters.find((each) => each.characterId === item.characterId)
  const who = owner ? sentence(owner.classType) : 'character'
  if (item.location === 'vault') return 'In vault'
  if (item.location === 'postmaster') return `Postmaster · ${who}`
  return item.equipped ? `Equipped on ${who}` : `On ${who}`
}

export function ItemHeader({ item, size = 64 }: { item: ItemSummary; size?: number }) {
  const where = useWhere(item)
  const kind = [
    sentence(item.tier),
    item.typeName,
    item.damageType === 'none' ? null : sentence(item.damageType),
  ]
    .filter(Boolean)
    .join(' · ')
  const tags = [
    item.locked ? 'Locked' : null,
    item.masterwork ? 'Masterwork' : null,
    item.duplicates > 0 ? `${item.duplicates + 1} copies` : null,
    item.decision ? sentence(item.decision) : null,
  ].filter(Boolean)
  return (
    <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 20 }}>
      <ItemIcon
        icon={item.icon}
        size={size}
        element={item.damageType}
        gearTier={item.gearTier}
        masterwork={item.masterwork}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Cond size={24} style={{ letterSpacing: 0.5, flexShrink: 1, lineHeight: 26 }} lines={2}>
            {upper(item.name)}
          </Cond>
          <Cond size={24} color={Ghost.gold} style={{ letterSpacing: 0, lineHeight: 26 }}>
            {item.power ?? ''}
          </Cond>
        </View>
        <Meta size={14} color={Rarity[item.tier]} style={{ marginTop: 4 }} lines={1}>
          {kind}
        </Meta>
        <Meta style={{ marginTop: 2 }} lines={1}>
          {[where, ...tags].join(' · ')}
        </Meta>
      </View>
    </View>
  )
}
