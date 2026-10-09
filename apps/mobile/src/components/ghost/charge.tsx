import type { ArmorMod } from '@ghost/contract'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Body, Chevron, Cut, Meta, Mono } from '@/components/ghost/ui'
import { Ghost, Type } from '@/constants/theme'
import { type ChargedMod } from '@/lib/charge'
import { firstSentence } from '@/lib/effect-text'
import { age } from '@/lib/format'

export function ChargeTag() {
  return <Meta color={Ghost.charge}>Charge</Meta>
}

/** What a mod adds while charged: Ghost's researched numbers, how many copies stack, and where the numbers come from. */
export function ChargeNote({
  mod,
  copies,
  under = Ghost.bg,
}: {
  mod: ArmorMod
  copies: number
  under?: string
}) {
  const effect = mod.chargeEffect
  const source = effect?.source
  return (
    <Cut
      cut={6}
      fill={`${Ghost.charge}14`}
      border={`${Ghost.charge}40`}
      under={under}
      style={styles.note}
    >
      <View style={styles.noteHead}>
        <Meta color={Ghost.charge}>With Armor Charge</Meta>
        {copies > 1 ? <Meta color={Ghost.charge}>×{copies} slotted</Meta> : null}
      </View>
      <Body size={14} color={effect ? Ghost.ink : Ghost.muted} style={{ lineHeight: 20 }}>
        {effect?.effect ?? 'Ghost has not looked up the numbers for this mod yet.'}
      </Body>
      {source ? (
        <Meta lines={1}>
          {[source.label, source.asOf ? age(source.asOf) : null].filter(Boolean).join(' · ')}
        </Meta>
      ) : null}
    </Cut>
  )
}

function ChargedRow({ entry, under }: { entry: ChargedMod; under: string }) {
  const [open, setOpen] = useState(false)
  const { mod, copies } = entry
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Shows what the mod adds with Armor Charge"
        onPress={() => setOpen((was) => !was)}
        style={({ pressed }) => [styles.rowHead, pressed && { opacity: 0.6 }]}
      >
        {mod.icon ? <Image source={mod.icon} style={styles.icon} transition={120} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body size={14} style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }} lines={1}>
            {copies > 1 ? `${mod.name} ×${copies}` : mod.name}
          </Body>
          <Meta lines={1}>{mod.chargeEffect?.effect ?? firstSentence(mod.description)}</Meta>
        </View>
        <Chevron direction={open ? 'up' : 'down'} size={6} color={Ghost.charge} />
      </Pressable>
      {open ? <ChargeNote mod={mod} copies={copies} under={under} /> : null}
    </View>
  )
}

/** Ghost's read on the conditional bonuses, then each armor charge mod, tap for its numbers. */
export function Situational({
  summary,
  mods,
  pending,
  under = Ghost.bg,
}: {
  summary: string | null | undefined
  mods: readonly ChargedMod[]
  pending?: boolean
  under?: string
}) {
  if (!summary && mods.length === 0 && !pending) return null
  return (
    <View>
      <Mono style={{ paddingBottom: 6 }}>SITUATIONAL</Mono>
      {summary ? (
        <Body size={14} color={Ghost.soft} style={{ lineHeight: 20, paddingBottom: 8 }}>
          {summary}
        </Body>
      ) : pending ? (
        <Body size={14} color={Ghost.muted} style={{ lineHeight: 20, paddingBottom: 8 }}>
          Ghost is reading up on your charge mods…
        </Body>
      ) : null}
      {mods.map((entry) => (
        <ChargedRow key={entry.mod.name} entry={entry} under={under} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: 6, paddingVertical: 9, paddingHorizontal: 11, gap: 5 },
  noteHead: { flexDirection: 'row', justifyContent: 'space-between' },
  row: { borderTopWidth: 1, borderTopColor: Ghost.rule, paddingVertical: 6 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 28, height: 28, backgroundColor: Ghost.swatch },
})
