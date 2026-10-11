import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { Body, Cond, Cut, Mono } from '@/components/ghost/ui'
import { Ghost, Type } from '@/constants/theme'
import { useFooterHeight } from '@/lib/footer'
import { useBottomInset } from '@/lib/insets'

export function Sheet({
  title,
  children,
  error,
  footer,
}: {
  title: string
  children: ReactNode
  error: string | null
  footer: ReactNode
}) {
  const bottomInset = useBottomInset()
  const footerSlot = useFooterHeight()
  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 20,
          paddingTop: 28,
          paddingBottom: footerSlot.height + 28,
          gap: 22,
        }}
      >
        <Cond size={24} style={{ letterSpacing: 0.5 }}>
          {title}
        </Cond>
        {children}
      </ScrollView>
      <View
        collapsable={false}
        onLayout={footerSlot.onLayout}
        style={[styles.footer, { paddingBottom: bottomInset + 12 }]}
      >
        {error ? (
          <Body size={13} color={Ghost.danger}>
            {error}
          </Body>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>{footer}</View>
      </View>
    </View>
  )
}

export function SheetField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder: string
}) {
  return (
    <View style={{ gap: 10 }}>
      <Mono>{label}</Mono>
      <Cut fill={Ghost.bg} border={Ghost.line} under={Ghost.panel}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Ghost.dim}
          keyboardAppearance="dark"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.input}
        />
      </Cut>
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    height: 44,
    paddingHorizontal: 12,
    fontFamily: Type.body,
    fontSize: 15,
    color: Ghost.ink,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Ghost.panel,
    borderTopWidth: 1,
    borderTopColor: Ghost.line,
  },
})
