import type { GuardianClass, Job, Plan, SavedBuild } from "@ghost/contract"
import { router, useLocalSearchParams } from "expo-router"
import { type ReactNode, useState } from "react"
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native"

import { SlotPicker } from "@/components/plan/slot-picker"
import { Body, Button, Cond, Cut, Meta, Mono, Tick } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import {
  errorMessage,
  useEquipBuild,
  useJob,
  useLoadoutSlots,
  useSaveBuild,
  useSavedBuilds,
} from "@/lib/api"
import { useCharacter, useWearer } from "@/lib/character"
import { sentence } from "@/lib/format"
import { useBottomInset } from "@/lib/insets"
import { type SlotChoice, slotChoice } from "@/lib/loadout-slots"

const openPlan = (job: Job, substituted: readonly string[] = []) =>
  router.replace({
    pathname: "/plan/[id]",
    params:
      substituted.length > 0 ? { id: job.id, substituted: substituted.join("\n") } : { id: job.id },
  })

function Where({
  on,
  locked,
  title,
  detail,
  onPress,
}: {
  on: boolean
  locked?: boolean
  title: string
  detail: string
  onPress?: () => void
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [styles.where, pressed && { opacity: 0.6 }]}
    >
      <View style={{ paddingTop: 3, opacity: locked ? 0.6 : 1 }}>
        <Tick on={on} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Body size={15} style={{ fontFamily: Type.bodyMedium, lineHeight: 19 }}>
          {title}
        </Body>
        <Meta>{detail}</Meta>
      </View>
    </Pressable>
  )
}

/** The slot picker for one character, with its choice derived from what the player tapped. */
function useSlots(characterId: string | undefined, holds: number | undefined) {
  const query = useLoadoutSlots(characterId)
  const [picked, setPicked] = useState<Partial<SlotChoice>>({})
  const choice = query.data ? slotChoice(query.data, picked, holds) : undefined
  return {
    query,
    choice,
    pick: (patch: Partial<SlotChoice>) => setPicked((was) => ({ ...was, ...patch })),
  }
}

function InGame({
  characterId,
  slots,
  builds,
  selfId,
}: {
  characterId: string | undefined
  slots: ReturnType<typeof useSlots>
  builds: readonly SavedBuild[]
  selfId?: string | undefined
}) {
  if (characterId === undefined)
    return <Meta color={Ghost.danger}>No character on this account can wear this build.</Meta>
  if (slots.query.isError)
    return (
      <Meta color={Ghost.danger}>
        Couldn't read your in-game loadouts: {errorMessage(slots.query.error)}
      </Meta>
    )
  if (!slots.query.data) return <Meta>Reading your in-game loadouts…</Meta>
  if (!slots.choice) return <Meta>The game offers no loadout slots to save into.</Meta>
  return (
    <SlotPicker
      slots={slots.query.data}
      choice={slots.choice}
      onPick={slots.pick}
      builds={builds}
      selfId={selfId}
    />
  )
}

function Sheet({
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
  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 22 }}
      >
        <Cond size={24} style={{ letterSpacing: 0.5 }}>
          {title}
        </Cond>
        {children}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
        {error ? (
          <Body size={13} color={Ghost.danger}>
            {error}
          </Body>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>{footer}</View>
      </View>
    </View>
  )
}

const classLabel = (classType: GuardianClass | undefined) =>
  classType ? sentence(classType) : "character"

/** The character a proposed build equips on. */
const planCharacter = (plan: Plan, job: Job) =>
  plan.loadout?.change?.characterId ??
  plan.rows.find((row) => row.characterId !== null)?.characterId ??
  job.characterId ??
  undefined

function SaveProposed({ job, plan }: { job: Job; plan: Plan }) {
  const { characters } = useCharacter()
  const builds = useSavedBuilds().data ?? []
  const save = useSaveBuild()
  const existing = builds.find((build) => build.jobId === job.id)
  const characterId = planCharacter(plan, job)
  const classType = characters.find((each) => each.characterId === characterId)?.classType
  const holds = existing?.inGame?.characterId === characterId ? existing?.inGame?.index : undefined
  const [name, setName] = useState(existing?.name ?? plan.subtitle ?? plan.title)
  const [inGame, setInGame] = useState(false)
  const slots = useSlots(inGame ? characterId : undefined, holds)
  const ready = name.trim().length > 0 && (!inGame || slots.choice !== undefined)

  const submit = () => {
    const slot =
      inGame && slots.choice && characterId ? { characterId, ...slots.choice } : undefined
    save.mutate(
      slot
        ? { jobId: job.id, name: name.trim(), inGame: slot }
        : { jobId: job.id, name: name.trim() },
      { onSuccess: (result) => (result.confirm ? openPlan(result.confirm) : router.back()) },
    )
  }

  return (
    <Sheet
      title="SAVE BUILD"
      error={save.isError ? errorMessage(save.error) : null}
      footer={
        <>
          <Button label="CANCEL" flex={0.6} under={Ghost.panel} onPress={() => router.back()} />
          <Button
            label={save.isPending ? "SAVING…" : inGame ? "SAVE & REVIEW" : "SAVE"}
            tone="solid"
            under={Ghost.panel}
            disabled={!ready || save.isPending}
            onPress={submit}
          />
        </>
      }
    >
      <View style={{ gap: 10 }}>
        <Mono>NAME</Mono>
        <Cut fill={Ghost.bg} border={Ghost.line} under={Ghost.panel}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="What this build is for"
            placeholderTextColor={Ghost.dim}
            keyboardAppearance="dark"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.input}
          />
        </Cut>
      </View>
      <View style={{ gap: 4 }}>
        <Mono>SAVE TO</Mono>
        <Where
          on
          locked
          title="Ghost"
          detail="Kept here so you can find it, filter it and equip it again."
        />
        <Where
          on={inGame}
          title="In game"
          detail={`Equips the build on your ${classLabel(classType)}, then saves it to a loadout slot. Nothing moves until you confirm.`}
          onPress={() => setInGame((was) => !was)}
        />
      </View>
      {inGame ? (
        <InGame characterId={characterId} slots={slots} builds={builds} selfId={existing?.id} />
      ) : null}
    </Sheet>
  )
}

function SaveFromJob({ jobId }: { jobId: string }) {
  const job = useJob(jobId)
  const plan = job.data?.plan
  if (!job.data || !plan)
    return (
      <Body color={job.isError ? Ghost.danger : Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {job.isError ? `Couldn't load this build: ${errorMessage(job.error)}` : "Loading…"}
      </Body>
    )
  return <SaveProposed job={job.data} plan={plan} />
}

/** Puts a build already saved in Ghost into an in-game slot: equip it, then snapshot it. */
function SaveSavedInGame({ build }: { build: SavedBuild }) {
  const builds = useSavedBuilds().data ?? []
  const equip = useEquipBuild()
  const wearer = useWearer(build.facets.classType)
  const characterId = wearer?.characterId
  const holds = build.inGame?.characterId === characterId ? build.inGame?.index : undefined
  const slots = useSlots(characterId, holds)

  return (
    <Sheet
      title="SAVE IN GAME"
      error={equip.isError ? errorMessage(equip.error) : null}
      footer={
        <>
          <Button label="CANCEL" flex={0.6} under={Ghost.panel} onPress={() => router.back()} />
          <Button
            label={equip.isPending ? "WORKING…" : "REVIEW"}
            tone="solid"
            under={Ghost.panel}
            disabled={slots.choice === undefined || characterId === undefined || equip.isPending}
            onPress={() => {
              if (!slots.choice || !characterId) return
              equip.mutate(
                { id: build.id, characterId, saveTo: { characterId, ...slots.choice } },
                { onSuccess: (result) => openPlan(result.job, result.substituted) },
              )
            }}
          />
        </>
      }
    >
      <Body size={14} color={Ghost.soft} style={{ lineHeight: 20 }}>
        {`${build.name} goes on your ${classLabel(build.facets.classType)} first, then into the slot. You confirm the plan before anything moves.`}
      </Body>
      <InGame characterId={characterId} slots={slots} builds={builds} selfId={build.id} />
    </Sheet>
  )
}

function SaveFromBuild({ buildId }: { buildId: string }) {
  const builds = useSavedBuilds()
  const build = builds.data?.find((each) => each.id === buildId)
  if (!build)
    return (
      <Body color={Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {builds.isPending ? "Loading…" : "This build is no longer saved."}
      </Body>
    )
  return <SaveSavedInGame build={build} />
}

/**
 * Saving a build: always in Ghost, and in game on request. A proposed build
 * comes by `jobId`; a build already saved comes by `buildId` to go in game.
 */
export default function SaveBuildScreen() {
  const { jobId, buildId } = useLocalSearchParams<{ jobId?: string; buildId?: string }>()
  if (buildId) return <SaveFromBuild buildId={buildId} />
  if (jobId) return <SaveFromJob jobId={jobId} />
  return null
}

const styles = StyleSheet.create({
  input: {
    height: 44,
    paddingHorizontal: 12,
    fontFamily: Type.body,
    fontSize: 15,
    color: Ghost.ink,
  },
  where: { flexDirection: "row", gap: 12, paddingVertical: 10 },
  footer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Ghost.panel,
    borderTopWidth: 1,
    borderTopColor: Ghost.line,
  },
})
