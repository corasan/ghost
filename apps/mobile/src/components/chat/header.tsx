import type { ContextFill, GuardianCharacter } from '@ghost/contract'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Bars, Cond, Cut, Diamond, useOpenDrawer } from '@/components/ghost/ui'
import { fillTone } from '@/components/usage/fill-bar'
import { Ghost } from '@/constants/theme'
import { percent } from '@/lib/format'
import { contextShare } from '@/lib/usage'

// Colour of the header glow behind the controls, so their cut corners blend
// in (see Cut).
const UNDER_GLOW = '#111418'

/** The chat's only chrome: the drawer, the Ghost mark, context used, a fresh chat, and your power. */
export function ChatHeader({
  character,
  ruled,
  context,
  onNewChat,
}: {
  character: GuardianCharacter | undefined
  ruled: boolean
  context?: ContextFill | null
  onNewChat?: () => void
}) {
  const insets = useSafeAreaInsets()
  const openDrawer = useOpenDrawer()
  const under = ruled ? Ghost.bg : UNDER_GLOW
  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingBottom: 12,
        paddingLeft: 20,
        paddingRight: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: ruled ? 1 : 0,
        borderBottomColor: Ghost.headerRule,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        hitSlop={12}
        onPress={openDrawer}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
      >
        <Bars />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {character?.ghostIcon ? (
            <Image
              source={character.ghostIcon}
              style={{ width: 28, height: 28, borderRadius: 14 }}
              transition={120}
            />
          ) : (
            <Diamond size={9} />
          )}
          <Cond size={19} style={{ letterSpacing: 3 }}>
            GHOST
          </Cond>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {context ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Context ${percent(contextShare(context))} full, open usage`}
            hitSlop={8}
            onPress={() => router.navigate('/usage')}
          >
            <Cut
              border={Ghost.line}
              under={under}
              style={{ paddingVertical: 6, paddingHorizontal: 10 }}
            >
              <Cond size={14} color={fillTone(contextShare(context))} style={{ lineHeight: 20 }}>
                {percent(contextShare(context))}
              </Cond>
            </Cut>
          </Pressable>
        ) : null}
        {onNewChat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
            hitSlop={8}
            onPress={onNewChat}
          >
            <Cut
              border={Ghost.line}
              under={under}
              style={{ paddingVertical: 6, paddingHorizontal: 10 }}
            >
              <Cond size={14} color={Ghost.accent} style={{ lineHeight: 20 }}>
                NEW
              </Cond>
            </Cut>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          hitSlop={8}
          onPress={openDrawer}
        >
          <Cut
            fill={Ghost.panel}
            border={Ghost.line}
            under={under}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 6,
              paddingHorizontal: 10,
            }}
          >
            <Diamond size={12} color={Ghost.ink} outline />
            <Cond size={18} color={Ghost.gold} style={{ letterSpacing: 0.7, lineHeight: 20 }}>
              {character?.light ?? '—'}
            </Cond>
          </Cut>
        </Pressable>
      </View>
    </View>
  )
}
