import { Pressable, TextInput, View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated'

import { Body, Chevron, Cut, Mono } from '@/components/ghost/ui'
import { Ghost, Type } from '@/constants/theme'
import { useBottomInset } from '@/lib/insets'

export const STARTERS = [
  'Best hand cannon for Trials',
  'Void build, 100 Resilience, 100 Recovery',
  'Clean up my vault',
  'What did I get yesterday?',
]

/** Starter prompts as a plain list above the composer, shown until you've asked something. */
export function Starters({ onAsk }: { onAsk: (prompt: string) => void }) {
  return (
    <View style={{ paddingHorizontal: 20 }}>
      <Mono style={{ paddingBottom: 10 }}>TRY ASKING</Mono>
      {STARTERS.map((prompt) => (
        <Pressable
          key={prompt}
          accessibilityRole="button"
          onPress={() => onAsk(prompt)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: Ghost.rule,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Body size={15} color={Ghost.soft}>
            {prompt}
          </Body>
          <Chevron />
        </Pressable>
      ))}
    </View>
  )
}

export function Composer({
  value,
  onChange,
  onSend,
  sending,
}: {
  value: string
  onChange: (text: string) => void
  onSend: () => void
  sending: boolean
}) {
  const bottomInset = useBottomInset()
  const ready = value.trim() !== '' && !sending
  const { progress } = useReanimatedKeyboardAnimation()
  const resting = Math.max(bottomInset, 12)
  const lift = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [resting, 10]),
  }))
  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          paddingTop: 12,
          paddingHorizontal: 16,
        },
        lift,
      ]}
    >
      <Cut fill={Ghost.panel} border={Ghost.line} style={{ flex: 1, minHeight: 46 }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Ask Ghost"
          placeholderTextColor={Ghost.dim}
          keyboardAppearance="dark"
          multiline
          submitBehavior="submit"
          returnKeyType="send"
          onSubmitEditing={ready ? onSend : undefined}
          style={{
            maxHeight: 120,
            paddingHorizontal: 14,
            paddingTop: 13,
            paddingBottom: 13,
            fontFamily: Type.body,
            fontSize: 15,
            color: Ghost.ink,
          }}
        />
      </Cut>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        disabled={!ready}
        onPress={onSend}
      >
        <Cut
          fill={ready ? Ghost.ink : Ghost.panel}
          border={ready ? undefined : Ghost.line}
          style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ marginLeft: -3 }}>
            <Chevron size={9} color={ready ? Ghost.bg : Ghost.ink} />
          </View>
        </Cut>
      </Pressable>
    </Animated.View>
  )
}
