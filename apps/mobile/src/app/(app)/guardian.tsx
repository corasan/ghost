import type { CharacterStats, ItemSummary } from '@ghost/contract'
import { LegendList } from '@legendapp/list/react-native'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { ChatHeader } from '@/components/chat/header'
import { Situational } from '@/components/ghost/charge'
import { SubclassBanner } from '@/components/ghost/subclass-banner'
import { Unavailable } from '@/components/ghost/unavailable'
import { ItemIcon } from '@/components/ghost/item-icon'
import { ModStrip } from '@/components/ghost/mod-strip'
import { Body, Chevron, Cond, Meta, Mono, Nudge, TierStats } from '@/components/ghost/ui'
import { Ghost, Gutter, Rarity, Type } from '@/constants/theme'
import { useGuardian, useSituational } from '@/lib/api'
import { chargedMods } from '@/lib/charge'
import { useCharacter } from '@/lib/character'
import { sentence } from '@/lib/format'
import { usePullRefresh } from '@/lib/refresh'
import { useBottomInset } from '@/lib/insets'

const WEAPON_SLOTS: readonly ItemSummary['slot'][] = ['kinetic', 'energy', 'power']
const ARMOR_SLOTS: readonly ItemSummary['slot'][] = ['helmet', 'arms', 'chest', 'legs', 'class']

const STAT_LABELS: readonly (readonly [keyof CharacterStats, string])[] = [
  ['resilience', 'Health'],
  ['strength', 'Melee'],
  ['discipline', 'Grenade'],
  ['intellect', 'Super'],
  ['recovery', 'Class'],
  ['mobility', 'Weapons'],
]

const STRONG_STAT = 100

type Kind = 'weapon' | 'armor'

type Row =
  | { type: 'label'; key: string; label: string }
  | { type: Kind; key: string; item: ItemSummary; others: ItemSummary[]; open: boolean }

const bySlot = (items: readonly ItemSummary[], slot: ItemSummary['slot']) =>
  items.filter((item) => item.slot === slot).sort((a, b) => (b.power ?? 0) - (a.power ?? 0))

const slotRows = (
  kind: Kind,
  slots: readonly ItemSummary['slot'][],
  equipment: readonly ItemSummary[],
  carried: readonly ItemSummary[],
  open: ReadonlySet<ItemSummary['slot']>,
): Row[] =>
  slots.flatMap((slot) =>
    bySlot(equipment, slot).map((item): Row => {
      const others = bySlot(carried, slot)
      return {
        type: kind,
        key: `${kind}-${slot}`,
        item,
        others,
        open: open.has(slot) && others.length > 0,
      }
    }),
  )

const dotted = (parts: readonly (string | null)[]) => parts.filter(Boolean).join(' · ')

const weaponMeta = (item: ItemSummary) =>
  dotted([
    sentence(item.slot),
    item.damageType === 'none' || item.damageType === item.slot ? null : sentence(item.damageType),
    item.typeName,
  ])

function CarriedCount({ count, open }: { count: number; open: boolean }) {
  if (count === 0) return <View style={{ width: 24 }} />
  return (
    <View style={{ width: 24, alignItems: 'flex-end', gap: 5 }}>
      <Mono size={11} color={open ? Ghost.ink : Ghost.dim} style={{ letterSpacing: 0 }}>
        +{count}
      </Mono>
      <Chevron direction={open ? 'up' : 'down'} size={6} />
    </View>
  )
}

const openItem = (id: string | null) => {
  if (id) router.push({ pathname: '/item/[id]', params: { id } })
}

const openActions = (id: string | null) => {
  if (id) router.push({ pathname: '/item-actions/[id]', params: { id } })
}

function ItemRow({
  item,
  kind,
  carried = 0,
  open = false,
  nested = false,
  onToggle,
}: {
  item: ItemSummary
  kind: Kind
  carried?: number
  open?: boolean
  nested?: boolean
  onToggle?: () => void
}) {
  const exotic = item.tier === 'exotic'
  const weapon = kind === 'weapon'
  const id = item.itemInstanceId
  const expands = onToggle !== undefined && carried > 0
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expands ? { expanded: open } : undefined}
      accessibilityHint={
        expands ? `Shows the ${carried} other ${sentence(item.slot)} carried` : 'Opens the item'
      }
      accessibilityActions={expands ? [{ name: 'open', label: 'Open item' }] : undefined}
      onAccessibilityAction={() => openItem(id)}
      onPress={expands ? onToggle : () => openItem(id)}
      onLongPress={() => openActions(id)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: nested ? 4 : weapon ? 8 : 6,
          borderTopWidth: nested ? 0 : 1,
          borderTopColor: Ghost.rule,
        },
        nested && {
          marginLeft: 16,
          paddingLeft: 12,
          borderLeftWidth: 1,
          borderLeftColor: Ghost.ruleStrong,
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Pressable
        accessible={false}
        disabled={id === null}
        onPress={() => openItem(id)}
        onLongPress={() => openActions(id)}
        style={({ pressed }) => pressed && { opacity: 0.6 }}
      >
        <ItemIcon
          icon={item.icon}
          size={nested ? 40 : 48}
          element={item.damageType}
          gearTier={item.gearTier}
          masterwork={item.masterwork}
        />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body
          size={nested ? 15 : 16}
          color={nested ? Ghost.soft : Ghost.ink}
          style={{ fontFamily: Type.bodyMedium, lineHeight: 19 }}
          lines={1}
        >
          {item.name}
        </Body>
        {weapon || !item.mods ? (
          <Meta color={exotic ? Rarity.exotic : Ghost.muted} style={{ marginTop: 2 }} lines={1}>
            {weapon ? weaponMeta(item) : dotted([sentence(item.slot), exotic ? 'Exotic' : null])}
          </Meta>
        ) : null}
        {item.mods && item.mods.length > 0 ? <ModStrip mods={item.mods} /> : null}
      </View>
      <Cond size={nested ? 16 : 18} color={Ghost.gold} style={{ letterSpacing: 0 }}>
        {item.power ?? '—'}
      </Cond>
      <CarriedCount count={nested ? 0 : carried} open={open} />
    </Pressable>
  )
}

/** The subclass on top, then stats in one row and weapons and armor down the page. */
export default function GuardianScreen() {
  const bottomInset = useBottomInset()
  const guardian = useGuardian()
  const { character } = useCharacter()
  const situational = useSituational(character?.characterId)
  const pull = usePullRefresh(guardian.refetch, situational.refetch)
  const [open, setOpen] = useState<ReadonlySet<ItemSummary['slot']>>(new Set())
  const toggle = (slot: ItemSummary['slot']) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(slot)) next.add(slot)
      return next
    })

  if (!character) {
    return (
      <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
        <ChatHeader character={undefined} ruled={false} />
        <View style={{ paddingHorizontal: Gutter }}>
          {guardian.isPending ? (
            <Body color={Ghost.dim} style={{ paddingTop: 32 }}>
              Loading…
            </Body>
          ) : guardian.error ? (
            <Unavailable error={guardian.error} onRetry={() => void guardian.refetch()} />
          ) : (
            <Body color={Ghost.dim} style={{ paddingTop: 32 }}>
              No Guardians on this account yet.
            </Body>
          )}
        </View>
      </View>
    )
  }

  const carried = character.carried ?? []
  const rows: Row[] = [
    { type: 'label', key: 'weapons', label: 'WEAPONS' },
    ...slotRows('weapon', WEAPON_SLOTS, character.equipment, carried, open),
    { type: 'label', key: 'armor', label: 'ARMOR' },
    ...slotRows('armor', ARMOR_SLOTS, character.equipment, carried, open),
  ]
  const postmaster = character.postmasterCount
  const capacity = guardian.data?.postmasterCapacity ?? 21

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
      <ChatHeader character={character} ruled={false} />
      <LegendList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        recycleItems
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: Gutter, paddingTop: 2, paddingBottom: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Mono size={11} color={Ghost.accent} style={{ letterSpacing: 1.4 }}>
                GUARDIAN
              </Mono>
              <Meta>
                {sentence(character.classType)} · Power {character.light}
              </Meta>
            </View>
            {character.loadout ? (
              <View style={{ paddingTop: 12 }}>
                <SubclassBanner
                  loadout={character.loadout}
                  chevron="right"
                  hint="Opens the subclass"
                  onPress={() => router.push('/subclass')}
                />
              </View>
            ) : null}
            <View style={{ paddingTop: 16 }}>
              <TierStats
                stats={STAT_LABELS.map(([key, label]) => ({
                  label,
                  value: character.stats[key],
                  target: character.stats[key] >= STRONG_STAT,
                }))}
              />
            </View>
          </View>
        }
        ListFooterComponent={
          <>
            {situational.data && situational.data.mods.length > 0 ? (
              <View style={{ paddingHorizontal: Gutter, paddingTop: 22 }}>
                <Situational
                  summary={situational.data.summary}
                  mods={chargedMods(situational.data.mods)}
                  pending={situational.data.pending}
                />
              </View>
            ) : null}
            {postmaster > 0 ? (
              <View style={{ paddingTop: 18 }}>
                <Nudge
                  text={`Postmaster is at ${postmaster} of ${capacity}. Clear it before you lose drops?`}
                  action="ASK"
                  prompt="Empty the postmaster into the vault"
                />
              </View>
            ) : null}
          </>
        }
        renderItem={({ item: row }) =>
          row.type === 'label' ? (
            <Mono
              style={{
                paddingHorizontal: Gutter,
                paddingTop: row.key === 'armor' ? 16 : 6,
                paddingBottom: 6,
                letterSpacing: 1.3,
              }}
            >
              {row.label}
            </Mono>
          ) : (
            <View style={{ paddingHorizontal: Gutter }}>
              <ItemRow
                item={row.item}
                kind={row.type}
                carried={row.others.length}
                open={row.open}
                onToggle={() => toggle(row.item.slot)}
              />
              {row.open ? (
                <View style={{ paddingBottom: 8 }}>
                  {row.others.map((other, i) => (
                    <ItemRow
                      key={other.itemInstanceId ?? `${row.item.slot}${i}`}
                      item={other}
                      kind={row.type}
                      nested
                    />
                  ))}
                </View>
              ) : null}
            </View>
          )
        }
      />
    </View>
  )
}
