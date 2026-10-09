import type { SubclassLoadout } from '@ghost/contract'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { SubclassMark } from '@/components/ghost/subclass-mark'
import { Body, Chevron, Cond, Cut, Meta } from '@/components/ghost/ui'
import { ELEMENT_TONE, Ghost } from '@/constants/theme'
import { sentence, upper } from '@/lib/format'

/** The subclass at a glance: its mark, name, element, aspects and fragment count, what a build switches it from, and whatever it opens. */
export function SubclassBanner({
  loadout,
  chevron,
  hint,
  expanded,
  onPress,
  children,
}: {
  loadout: SubclassLoadout
  chevron: 'right' | 'down' | 'up'
  hint: string
  expanded?: boolean
  onPress: () => void
  children?: ReactNode
}) {
  const tone = ELEMENT_TONE[loadout.element]
  const change = loadout.change
  const fragments = loadout.fragments.length
  const summary = [
    ...loadout.aspects.map((aspect) => aspect.name),
    fragments > 0 ? `${fragments} ${fragments === 1 ? 'fragment' : 'fragments'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Cut cut={8} fill={`${tone}1a`} border={`${tone}4d`}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={hint}
        {...(expanded === undefined ? {} : { accessibilityState: { expanded } })}
        onPress={onPress}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 13,
            paddingHorizontal: 14,
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <SubclassMark loadout={loadout} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Cond size={20} style={{ letterSpacing: 0.8, lineHeight: 21 }}>
              {upper(loadout.subclass ?? 'Subclass')}
            </Cond>
            {loadout.element !== 'none' ? (
              <Meta color={tone}>{sentence(loadout.element)}</Meta>
            ) : null}
          </View>
          {summary ? (
            <Meta style={{ marginTop: 3 }} lines={1}>
              {summary}
            </Meta>
          ) : null}
          {change?.replaces ? (
            <Meta color={Ghost.accent} style={{ marginTop: 3 }}>
              Swap · replaces {change.replaces}
            </Meta>
          ) : null}
          {change?.error ? (
            <Body size={13} color={Ghost.danger} style={{ lineHeight: 18, marginTop: 4 }}>
              {change.error}
            </Body>
          ) : null}
        </View>
        <Chevron direction={chevron} color={tone} />
      </Pressable>
      {children}
    </Cut>
  )
}
