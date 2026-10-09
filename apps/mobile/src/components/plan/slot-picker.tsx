import type { InGameSlot, LoadoutIdentity, LoadoutSlots, SavedBuild } from '@ghost/contract'
import { Image } from 'expo-image'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Body, Chip, Cut, Meta, Mono } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import type { SlotChoice } from '@/lib/loadout-slots'

const SLOTS_PER_ROW = 5

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Mono>{label}</Mono>
      {children}
    </View>
  )
}

function SlotTile({
  slot,
  chosen,
  onPress,
}: {
  slot: InGameSlot
  chosen: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityLabel={`Slot ${slot.index + 1}, ${slot.empty ? 'empty' : (slot.name?.name ?? 'filled')}`}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, gap: 4 }, pressed && { opacity: 0.6 }]}
    >
      <Cut
        cut={5}
        fill={Ghost.swatch}
        border={chosen ? Ghost.accent : Ghost.ruleStrong}
        under={Ghost.panel}
        style={styles.tile}
      >
        {slot.color?.icon ? (
          <Image source={slot.color.icon} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        {slot.icon?.icon ? (
          <Image source={slot.icon.icon} style={styles.slotIcon} contentFit="contain" />
        ) : (
          <Mono size={13} color={chosen ? Ghost.accent : Ghost.dim}>
            {slot.index + 1}
          </Mono>
        )}
      </Cut>
      <Meta size={11} color={chosen ? Ghost.accent : Ghost.dim} lines={1}>
        {slot.empty ? 'Empty' : (slot.name?.name ?? `Slot ${slot.index + 1}`)}
      </Meta>
    </Pressable>
  )
}

function Swatches({
  options,
  chosen,
  onPick,
  label,
}: {
  options: readonly LoadoutIdentity[]
  chosen: number
  onPick: (hash: number) => void
  label: string
}) {
  return (
    <View style={styles.wrap}>
      {options.map((option) => {
        const on = option.hash === chosen
        return (
          <Pressable
            key={option.hash}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${option.name}`}
            accessibilityState={{ selected: on }}
            onPress={() => onPick(option.hash)}
            style={[styles.swatch, { borderColor: on ? Ghost.accent : Ghost.rule }]}
          >
            {option.icon ? (
              <Image source={option.icon} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Meta size={10}>{option.name}</Meta>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

const overwriting = (slot: InGameSlot, claimedBy: SavedBuild | undefined, selfId?: string) => {
  if (slot.empty) return null
  const current = slot.name?.name ?? `slot ${slot.index + 1}`
  if (claimedBy && claimedBy.id === selfId) return `Saves over this build's own slot, ${current}.`
  if (claimedBy) return `Overwrites ${current} in game. ${claimedBy.name} loses its in-game slot.`
  return `Overwrites ${current} in game.`
}

export function SlotPicker({
  slots,
  choice,
  onPick,
  builds,
  selfId,
}: {
  slots: LoadoutSlots
  choice: SlotChoice
  onPick: (patch: Partial<SlotChoice>) => void
  builds: readonly SavedBuild[]
  selfId?: string | undefined
}) {
  const rows = Array.from({ length: Math.ceil(slots.slots.length / SLOTS_PER_ROW) }, (_, i) =>
    slots.slots.slice(i * SLOTS_PER_ROW, (i + 1) * SLOTS_PER_ROW),
  )
  const chosen = slots.slots.find((slot) => slot.index === choice.index)
  const claimedBy = builds.find((build) => build.id === chosen?.savedBuildId)
  const warning = chosen ? overwriting(chosen, claimedBy, selfId) : null
  return (
    <View style={{ gap: 22 }}>
      <Group label="SLOT">
        <View style={{ gap: 10 }}>
          {rows.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              {row.map((slot) => (
                <SlotTile
                  key={slot.index}
                  slot={slot}
                  chosen={slot.index === choice.index}
                  onPress={() => onPick({ index: slot.index })}
                />
              ))}
              {Array.from({ length: SLOTS_PER_ROW - row.length }, (_, pad) => (
                <View key={pad} style={{ flex: 1 }} />
              ))}
            </View>
          ))}
        </View>
        {warning ? (
          <Body size={13} color={Ghost.gold} style={{ lineHeight: 18 }}>
            {warning}
          </Body>
        ) : null}
      </Group>
      <Group label="NAME IN GAME">
        <View style={styles.wrap}>
          {slots.names.map((name) => (
            <Chip
              key={name.hash}
              label={name.name.toUpperCase()}
              active={name.hash === choice.nameHash}
              onPress={() => onPick({ nameHash: name.hash })}
            />
          ))}
        </View>
      </Group>
      <Group label="COLOR">
        <Swatches
          label="Color"
          options={slots.colors}
          chosen={choice.colorHash}
          onPick={(colorHash) => onPick({ colorHash })}
        />
      </Group>
      <Group label="ICON">
        <Swatches
          label="Icon"
          options={slots.icons}
          chosen={choice.iconHash}
          onPick={(iconHash) => onPick({ iconHash })}
        />
      </Group>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  slotIcon: { width: '62%', height: '62%' },
  swatch: {
    width: 40,
    height: 40,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: Ghost.swatch,
  },
})
