import type { GuardianClass, ItemSummary, SavedBuild } from '@ghost/contract'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { ItemIcon } from '@/components/ghost/item-icon'
import { Body, Button, Cond, Meta, Mono } from '@/components/ghost/ui'
import { Sheet, SheetField } from '@/components/plan/sheet'
import { Ghost } from '@/constants/theme'
import { errorMessage, useBuildOptions, useEditBuild, useSavedBuilds } from '@/lib/api'
import {
  type BuildDraft,
  GEAR_SLOTS,
  type Gear,
  type GearSlot,
  draftOf,
  editOf,
  gearOfItem,
  sameEdit,
} from '@/lib/build-edit'
import { slotLabel } from '@/lib/plan-card'

const ICON = 40

function GearLine({ gear, detail }: { gear: Gear; detail?: string | undefined }) {
  return (
    <View style={styles.line}>
      <ItemIcon
        icon={gear.icon}
        size={ICON}
        element={gear.element}
        gearTier={gear.gearTier}
        masterwork={gear.masterwork}
        power={gear.power}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Body size={15} lines={1}>
          {gear.name}
        </Body>
        {detail ? <Meta size={12}>{detail}</Meta> : null}
      </View>
    </View>
  )
}

const owned = (item: ItemSummary): item is ItemSummary & { itemInstanceId: string } =>
  item.itemInstanceId !== null

function Options({
  buildId,
  slot,
  current,
  onPick,
}: {
  buildId: string
  slot: GearSlot
  current: Gear | null
  onPick: (gear: Gear) => void
}) {
  const options = useBuildOptions(buildId, slot)
  if (options.isError)
    return <Meta color={Ghost.danger}>Couldn't list your gear: {errorMessage(options.error)}</Meta>
  if (!options.data) return <Meta>Reading your gear…</Meta>
  const items = options.data.filter(owned).filter((item) => item.itemInstanceId !== current?.id)
  if (items.length === 0) return <Meta>Nothing else you own fits here.</Meta>
  return (
    <View style={styles.options}>
      {items.map((item) => (
        <Pressable
          key={item.itemInstanceId}
          accessibilityRole="button"
          accessibilityLabel={`Use ${item.name}`}
          onPress={() => onPick(gearOfItem(item))}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <GearLine gear={gearOfItem(item)} detail={item.typeName} />
        </Pressable>
      ))}
    </View>
  )
}

function SlotRow({
  buildId,
  slot,
  classType,
  gear,
  open,
  onToggle,
  onChange,
}: {
  buildId: string
  slot: GearSlot
  classType: GuardianClass
  gear: Gear | null
  open: boolean
  onToggle: () => void
  onChange: (gear: Gear | null) => void
}) {
  return (
    <View style={styles.slot}>
      <View style={styles.slotHead}>
        <Mono>{slotLabel(slot, classType).toUpperCase()}</Mono>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {gear && !open ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onChange(null)}>
              <Cond size={13} color={Ghost.danger}>
                REMOVE
              </Cond>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onToggle}>
            <Cond size={13} color={Ghost.accent}>
              {open ? 'DONE' : gear ? 'SWAP' : 'ADD'}
            </Cond>
          </Pressable>
        </View>
      </View>
      {gear ? <GearLine gear={gear} /> : <Meta>Empty</Meta>}
      {open ? (
        <Options
          buildId={buildId}
          slot={slot}
          current={gear}
          onPick={(picked) => onChange(picked)}
        />
      ) : null}
    </View>
  )
}

function EditForm({ build }: { build: SavedBuild }) {
  const edit = useEditBuild()
  const [initial] = useState(() => draftOf(build))
  const [draft, setDraft] = useState<BuildDraft>(initial)
  const [open, setOpen] = useState<GearSlot | undefined>()
  const payload = editOf(draft)
  const ready = payload.name.length > 0 && !sameEdit(editOf(initial), payload)

  const setGear = (slot: GearSlot, gear: Gear | null) => {
    setDraft((was) => ({ ...was, gear: { ...was.gear, [slot]: gear } }))
    setOpen(undefined)
  }

  return (
    <Sheet
      title="EDIT BUILD"
      error={edit.isError ? errorMessage(edit.error) : null}
      footer={
        <>
          <Button label="CANCEL" flex={0.6} under={Ghost.panel} onPress={() => router.back()} />
          <Button
            label={edit.isPending ? 'SAVING…' : 'SAVE'}
            tone="solid"
            under={Ghost.panel}
            disabled={!ready || edit.isPending}
            onPress={() =>
              edit.mutate({ id: build.id, ...payload }, { onSuccess: () => router.back() })
            }
          />
        </>
      }
    >
      <SheetField
        label="NAME"
        value={draft.name}
        onChangeText={(name) => setDraft((was) => ({ ...was, name }))}
        placeholder="What this build is called"
      />
      <SheetField
        label="FOR"
        value={draft.purpose}
        onChangeText={(purpose) => setDraft((was) => ({ ...was, purpose }))}
        placeholder="Raids, Trials, solo dungeons…"
      />
      <View>
        {GEAR_SLOTS.map((slot) => (
          <SlotRow
            key={slot}
            buildId={build.id}
            slot={slot}
            classType={build.facets.classType}
            gear={draft.gear[slot]}
            open={open === slot}
            onToggle={() => setOpen((was) => (was === slot ? undefined : slot))}
            onChange={(gear) => setGear(slot, gear)}
          />
        ))}
      </View>
    </Sheet>
  )
}

export default function EditBuildScreen() {
  const { buildId } = useLocalSearchParams<{ buildId: string }>()
  const builds = useSavedBuilds()
  const build = builds.data?.find((each) => each.id === buildId)
  if (!build)
    return (
      <Body color={Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {builds.isPending ? 'Loading…' : 'This build is no longer saved.'}
      </Body>
    )
  return <EditForm build={build} />
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slot: { gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Ghost.rule },
  slotHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  options: { gap: 10, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: Ghost.ruleStrong },
})
