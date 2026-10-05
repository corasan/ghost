import type { Job, LoadoutPlug, Plan, SubclassLoadout, PlanRow } from "@ghost/contract"
import { router, useLocalSearchParams } from "expo-router"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BuildHeader, PieceArt } from "@/components/chat/build-card"
import { BuildStats } from "@/components/chat/build-stats"
import { RowRight } from "@/components/chat/plan-block"
import { Body, Button, Diamond, Mono } from "@/components/ghost/ui"
import { ELEMENT_TONE, Ghost, Gutter, Type } from "@/constants/theme"
import { errorMessage, useApplyPlan, useJob } from "@/lib/api"
import { bySlot, liveLabel, pendingMasterwork, signed } from "@/lib/plan-card"
import { usePlanSelection } from "@/lib/selection"

/** Bungie's effect text opens with the gist; glyph tokens like "[Stasis]" have no icon here. */
const firstSentence = (text: string) =>
  text
    .replace(/\[[^\]]*\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?<=[.!?]) .*$/, "")

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

function Piece({ row, applied }: { row: PlanRow; applied: boolean }) {
  const stats = row.stats ?? []
  const now = stats.reduce((sum, stat) => sum + stat.value, 0)
  const then = stats.reduce((sum, stat) => sum + (stat.masterworked ?? stat.value), 0)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens item details"
      onPress={() => router.push({ pathname: "/item/[id]", params: { id: row.itemInstanceId } })}
      style={({ pressed }) => [styles.piece, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.pieceHead}>
        <View style={{ width: 44 }}>
          <PieceArt
            row={row}
            height={44}
            arriving={!applied && row.origin !== undefined && row.action !== "none"}
          />
        </View>
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
        <RowRight row={row} applied={applied} />
      </View>
      {stats.length > 0 ? (
        <View style={styles.pieceStats}>
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
    </Pressable>
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

  return (
    <View style={{ flex: 1 }}>
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
          {bySlot(plan.rows).map((row) => (
            <Piece key={row.itemInstanceId} row={row} applied={applied} />
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
  piece: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: Ghost.rule, gap: 9 },
  pieceHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  pieceStats: { flexDirection: "row", gap: 6, paddingLeft: 56 },
  footer: {
    paddingHorizontal: Gutter,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
})
