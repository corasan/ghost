import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { PlugIcon } from '@/components/ghost/plug-icon'
import { Body, Meta } from '@/components/ghost/ui'
import { Ghost, Type } from '@/constants/theme'
import { firstSentence } from '@/lib/effect-text'

export function ArtifactPerkRow({
  icon,
  name,
  description,
  trailing,
}: {
  icon: string | null
  name: string
  description: string
  trailing?: ReactNode
}) {
  return (
    <View style={styles.row}>
      <PlugIcon icon={icon} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body size={14} style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }}>
          {name}
        </Body>
        {description ? (
          <Meta style={{ marginTop: 1 }} lines={2}>
            {firstSentence(description)}
          </Meta>
        ) : null}
      </View>
      {trailing}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
})
