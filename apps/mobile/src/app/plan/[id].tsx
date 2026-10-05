import type { Job, LoadoutPlug, Plan, SubclassLoadout, PlanRow } from "@ghost/contract"
import { Image } from "expo-image"
import { router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BuildHeader, ModPips } from "@/components/chat/build-card"
import { BuildStats } from "@/components/chat/build-stats"
import { RowRight } from "@/components/chat/plan-block"
import { ItemIcon } from "@/components/ghost/item-icon"
import { Body, Button, Chevron, Diamond, Mono } from "@/components/ghost/ui"
import { ELEMENT_TONE, Ghost, Gutter, Type } from "@/constants/theme"
import { errorMessage, useApplyPlan, useJob } from "@/lib/api"
import { firstSentence } from "@/lib/effect-text"
import { bySlot, liveLabel, modPips, pendingMasterwork, signed } from "@/lib/plan-card"
import { usePlanSelection } from "@/lib/selection"

function Described({ plug, kind }: { plug: LoadoutPlug; kind?: string }) {
  const description = firstSentence(plug.description)
  return (
    <View style={styles.entry}>
      <Body size={14} style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }}>
        {plug.name}
      </Body>
      {kind || description ? (
        <Body size={11} color={Ghost.dim} style={{ lineHeight: 15, marginTop: 1 }} lines={2}>
          {[kind, description].filter(Boolean).join(" · ")}
        </Body>
      ) : null}
    </View>
  )
}

function Loadout({ loadout }: { loadout: SubclassLoadout }) {
  const tone = ELEMENT_TONE[loadout.element]
  if (!loadout.super && loadout.aspects.length === 0 && loadout.fragments.length === 0) return null
  return (
    <View style={styles.section}>
      <Mono style={styles.label}>LOADOUT</Mono>
      {loadout.super ? <Described plug={loadout.super} kind="Super" /> : null}
      {loadout.aspects.map((aspect) => (
        <Described key={aspect.name} plug={aspect} />
      ))}
      {loadout.fragments.map((fragment) => (
        <View key={fragment.name} style={[styles.entry, styles.fragment]}>
          <Diamond size={6} color={tone} />
          <Body size={13} color={Ghost.soft} style={{ flex: 1, lineHeight: 17 }}>
            {fragment.name}
          </Body>
          {fragment.mods.length === 0 ? (
            <Mono size={10}>—</Mono>
          ) : (
            fragment.mods.map((mod) => (
              <Mono key={mod.label} size={10} color={mod.delta > 0 ? Ghost.good : Ghost.danger}>
                {signed(mod.delta)} {mod.label}
              </Mono>
            ))
          )}
        </View>
      ))}
    </View>
  )
}

const NONE_OPEN = ""

function Mods({ row }: { row: PlanRow }) {
  const mods = row.armorMods
  if (mods === undefined) return null
  const free = row.freeModSlots ?? 0
  return (
    <View>
      <View style={styles.modsHead}>
        <Mono size={8}>MODS</Mono>
        {row.energy ? (
          <Mono size={8}>
            ENERGY {row.energy.used}/{row.energy.capacity}
          </Mono>
        ) : null}
      </View>
      {mods.map((mod, i) => {
        const effect = firstSentence(mod.description)
        return (
          <View key={`${mod.name}${i}`} style={styles.mod}>
            {mod.icon ? <Image source={mod.icon} style={styles.modIcon} transition={120} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Body size={13} style={{ fontFamily: Type.bodyMedium, lineHeight: 16 }}>
                {mod.name}
              </Body>
              {effect ? (
                <Body size={11} color={Ghost.dim} style={{ lineHeight: 14, marginTop: 1 }}>
                  {effect}
                </Body>
              ) : null}
            </View>
            <Mono style={{ letterSpacing: 0.7 }}>{mod.cost}</Mono>
          </View>
        )
      })}
      {free > 0 ? (
        <View style={styles.mod}>
          <Body size={13} color={Ghost.dim} style={{ lineHeight: 16 }}>
            {free} {free === 1 ? "slot free" : "slots free"}
          </Body>
        </View>
      ) : null}
    </View>
  )
}

function Piece({
  row,
  applied,
  open,
  onToggle,
}: {
  row: PlanRow
  applied: boolean
  open: boolean
  onToggle: () => void
}) {
  const stats = row.stats ?? []
  const now = stats.reduce((sum, stat) => sum + stat.value, 0)
  const then = stats.reduce((sum, stat) => sum + (stat.masterworked ?? stat.value), 0)
  const pips = modPips(row)
  return (
    <View style={styles.piece}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Shows stats and mods"
        onPress={onToggle}
        style={({ pressed }) => [styles.pieceHead, pressed && { opacity: 0.6 }]}
      >
        <ItemIcon
          icon={row.icon}
          size={48}
          element={row.damageType}
          gearTier={row.gearTier}
          masterwork={row.masterwork}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body size={15} style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }} lines={1}>
            {row.name}
          </Body>
          <Mono style={{ marginTop: 3, letterSpacing: 0.7 }} lines={1}>
            {row.error ?? row.meta}
          </Mono>
          {then > now ? (
            <Mono color={Ghost.gold} style={{ marginTop: 3, letterSpacing: 0.7 }}>
              {now} → {then} MASTERWORKED
            </Mono>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <RowRight row={row} applied={applied} />
          {pips ? <ModPips pips={pips} /> : null}
        </View>
        <Chevron direction={open ? "up" : "down"} size={6} />
      </Pressable>
      {open ? (
        <View style={styles.pieceBody}>
          {stats.length > 0 ? (
            <View style={{ flexDirection: "row", gap: 6 }}>
              {stats.map((stat) => (
                <View key={stat.label} style={{ flex: 1 }}>
                  <Mono
                    size={12}
                    color={
                      stat.masterworked !== undefined
                        ? Ghost.gold
                        : stat.value > 0
                          ? Ghost.ink
                          : Ghost.dim
                    }
                    style={{ letterSpacing: 0 }}
                  >
                    {stat.value}
                  </Mono>
                  <Mono size={7} style={{ marginTop: 3 }} lines={1}>
                    {stat.label}
                  </Mono>
                </View>
              ))}
            </View>
          ) : null}
          <Mods row={row} />
        </View>
      ) : null}
    </View>
  )
}

function Confirm({ job, plan, inset }: { job: Job; plan: Plan; inset: number }) {
  const selection = usePlanSelection(job.id, plan)
  const apply = useApplyPlan()
  const selected = [...selection.selected]
  if (plan.status !== "proposed" || selection.actionableCount === 0) return null
  return (
    <View style={[styles.footer, { paddingBottom: inset + 12 }]}>
      {apply.isError ? (
        <Body size={13} color={Ghost.danger}>
          {errorMessage(apply.error)}
        </Body>
      ) : null}
      <View style={{ flexDirection: "row" }}>
        <Button
          label={apply.isPending ? "WORKING…" : liveLabel(plan.confirmLabel, selected.length)}
          tone="solid"
          under={Ghost.panel}
          disabled={selected.length === 0 || apply.isPending}
          onPress={() =>
            apply.mutate({ jobId: job.id, selected }, { onSuccess: () => router.back() })
          }
        />
      </View>
    </View>
  )
}

/**
 * The build card unfolded in the same order: what each part of the subclass
 * does, the stats now, with the build and masterworked, and every piece by name.
 */
export default function PlanDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const job = useJob(id)
  const [openId, setOpenId] = useState<string>()
  const plan = job.data?.plan

  if (!job.data || !plan) {
    return (
      <Body color={job.isError ? Ghost.danger : Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {job.isError ? `Couldn't load this build: ${errorMessage(job.error)}` : "Loading…"}
      </Body>
    )
  }

  const applied = plan.status !== "proposed"
  const pending = pendingMasterwork(plan)
  const loadout = plan.loadout
  const pieces = bySlot(plan.rows)

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <BuildHeader
          plan={plan}
          eyebrowSize={10}
          eyebrow={[loadout?.classType, loadout?.subclass, loadout?.element]
            .filter((part) => part && part !== "none")
            .join(" · ")
            .toUpperCase()}
        />
        {loadout ? <Loadout loadout={loadout} /> : null}
        <View style={styles.section}>
          <BuildStats stats={plan.stats} />
        </View>
        <View style={styles.section}>
          <View style={[styles.label, { flexDirection: "row", justifyContent: "space-between" }]}>
            <Mono>PIECES</Mono>
            {pending > 0 ? <Mono color={Ghost.gold}>{pending} NOT MASTERWORKED</Mono> : null}
          </View>
          {pieces.map((row) => (
            <Piece
              key={row.itemInstanceId}
              row={row}
              applied={applied}
              open={(openId ?? pieces[0]?.itemInstanceId) === row.itemInstanceId}
              onToggle={() =>
                setOpenId((current) =>
                  (current ?? pieces[0]?.itemInstanceId) === row.itemInstanceId
                    ? NONE_OPEN
                    : row.itemInstanceId,
                )
              }
            />
          ))}
        </View>
        {plan.note ? (
          <Body size={13} color={Ghost.muted} style={{ lineHeight: 18, marginTop: 14 }}>
            {plan.note}
          </Body>
        ) : null}
      </ScrollView>
      <Confirm job={job.data} plan={plan} inset={insets.bottom} />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 28, paddingBottom: 28 },
  section: { marginTop: 18 },
  label: { paddingBottom: 6 },
  entry: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: Ghost.rule },
  fragment: { flexDirection: "row", alignItems: "center", gap: 10 },
  piece: { borderTopWidth: 1, borderTopColor: Ghost.rule },
  pieceHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  pieceBody: { paddingLeft: 60, paddingTop: 2, paddingBottom: 12, gap: 10 },
  modsHead: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 4 },
  modIcon: { width: 28, height: 28, backgroundColor: Ghost.swatch },
  mod: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  footer: {
    paddingHorizontal: Gutter,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
