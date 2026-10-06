import type { Job, Plan, PlanPerk, PlanRow } from "@ghost/contract"
import { router } from "expo-router"
import { useState } from "react"
import { Alert, Pressable, StyleSheet, View } from "react-native"

import { ItemIcon } from "@/components/ghost/item-icon"
import {
  Body,
  Button,
  Cond,
  Cut,
  Meta,
  Mono,
  StatLabel,
  TierStats,
  Tick,
} from "@/components/ghost/ui"
import { Ghost, Rarity, Type } from "@/constants/theme"
import { errorMessage, useApplyPlan, useUndoPlan } from "@/lib/api"
import { liveLabel } from "@/lib/plan-card"
import { usePlanSelection } from "@/lib/selection"
import { BuildCard } from "./build-card"

// A plan is a block in the conversation, not a modal: the resulting stats,
// one row per change that can be unticked, and one confirm. After it runs,
// the same block shows what happened to each row and offers undo.

const COLLAPSED_ROWS = 4
const COLLAPSE_OVER = 6

const openItem = (id: string) => router.push({ pathname: "/item/[id]", params: { id } })

const outcomeTone = { ok: Ghost.good, failed: Ghost.danger, skipped: Ghost.dim } as const

export function RowRight({ row, applied }: { row: PlanRow; applied: boolean }) {
  if (applied && row.outcome) {
    return (
      <Meta color={outcomeTone[row.outcome]}>
        {row.outcome === "ok" ? "Done" : row.outcome === "failed" ? "Failed" : "Held"}
      </Meta>
    )
  }
  if (row.score !== null) {
    const color = row.score >= 70 ? Ghost.good : row.score >= 40 ? Ghost.gold : Ghost.danger
    return (
      <View style={{ alignItems: "flex-end" }}>
        <Cond size={20} color={color} style={{ letterSpacing: 0, lineHeight: 20 }}>
          {row.score}
        </Cond>
        <Meta size={12}>Roll</Meta>
      </View>
    )
  }
  return (
    <Cond
      size={16}
      color={row.power === null ? Ghost.dim : Ghost.gold}
      style={{ letterSpacing: 0 }}
    >
      {row.power ?? "—"}
    </Cond>
  )
}

export function PlanRowView({
  row,
  ticked,
  onToggle,
  applied,
  under = Ghost.panel,
  inset = 14,
}: {
  row: PlanRow
  ticked: boolean
  onToggle?: () => void
  applied: boolean
  under?: string
  inset?: number
}) {
  const actionable = row.action !== "none"
  const tickable = actionable && !applied && onToggle !== undefined
  return (
    <View
      style={[
        styles.row,
        { paddingLeft: tickable ? 0 : inset, paddingRight: inset },
        actionable && !applied && !ticked && { opacity: 0.45 },
      ]}
    >
      {tickable ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={row.name}
          accessibilityState={{ checked: ticked }}
          onPress={onToggle}
          style={{ alignSelf: "stretch", justifyContent: "center", paddingHorizontal: inset }}
        >
          <Tick on={ticked} under={under} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens item details"
        onPress={() => openItem(row.itemInstanceId)}
        style={({ pressed }) => [styles.rowBody, pressed && { opacity: 0.6 }]}
      >
        <View style={styles.rowHead}>
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
            <Meta color={row.error ? Ghost.danger : Ghost.muted} style={{ marginTop: 2 }} lines={1}>
              {row.error ?? row.meta}
            </Meta>
          </View>
          <RowRight row={row} applied={applied} />
        </View>
      </Pressable>
    </View>
  )
}

export function Perks({ perks }: { perks: readonly PlanPerk[] }) {
  return (
    <View style={styles.perks}>
      {perks.map((perk) => (
        <View
          key={perk.name}
          style={[styles.perk, { borderColor: perk.good ? Ghost.good : Ghost.ruleStrong }]}
        >
          <Body size={12} color={perk.good ? Ghost.good : Ghost.muted}>
            {perk.name}
          </Body>
        </View>
      ))}
    </View>
  )
}

function Featured({ plan, row }: { plan: Plan; row: PlanRow }) {
  const featured = plan.featured
  if (featured === null) return null
  const tone = Rarity[row.tier]
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens item details"
        onPress={() => openItem(row.itemInstanceId)}
        style={({ pressed }) => [
          { flexDirection: "row", gap: 14, padding: 14 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <ItemIcon
          icon={row.icon}
          size={72}
          element={row.damageType}
          gearTier={row.gearTier}
          masterwork={row.masterwork}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.between}>
            <Cond size={24} style={{ letterSpacing: 0.5, flexShrink: 1 }} lines={1}>
              {row.name.toUpperCase()}
            </Cond>
            {row.score !== null ? (
              <Cond size={24} color={Ghost.good} style={{ letterSpacing: 0 }}>
                {row.score}
              </Cond>
            ) : null}
          </View>
          <Meta color={tone} style={{ marginTop: 4 }} lines={1}>
            {row.meta}
          </Meta>
          <Perks perks={featured.perks} />
        </View>
      </Pressable>
      {featured.stats.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 7 }}>
          {featured.stats.map((stat, i) => (
            <View key={stat.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <StatLabel label={stat.label} size={13} style={{ width: 84 }} />
              <View style={{ flex: 1, height: 3, backgroundColor: Ghost.rule }}>
                <View
                  style={{
                    width: `${Math.max(0, Math.min(100, stat.value))}%`,
                    height: 3,
                    backgroundColor: i === 0 || stat.target ? Ghost.ink : Ghost.dim,
                  }}
                />
              </View>
              <Mono size={13} color={Ghost.ink} style={{ width: 32, textAlign: "right" }}>
                {stat.value}
              </Mono>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export function PlanBlock({
  job,
  plan,
  onAsk,
}: {
  job: Job
  plan: Plan
  onAsk: (prompt: string) => void
}) {
  return plan.kind === "build" ? (
    <BuildCard job={job} plan={plan} />
  ) : (
    <ItemPlan job={job} plan={plan} onAsk={onAsk} />
  )
}

function ItemPlan({ job, plan, onAsk }: { job: Job; plan: Plan; onAsk: (prompt: string) => void }) {
  const selection = usePlanSelection(job.id, plan)
  const apply = useApplyPlan()
  const undo = useUndoPlan()
  const [expanded, setExpanded] = useState(false)

  const applied = plan.status !== "proposed"
  const featuredRow = plan.featured
    ? plan.rows.find((row) => row.itemInstanceId === plan.featured?.itemInstanceId)
    : undefined
  const rows = plan.rows.filter((row) => row !== featuredRow)
  const collapsed = !expanded && rows.length > COLLAPSE_OVER
  const shown = collapsed ? rows.slice(0, COLLAPSED_ROWS) : rows
  const hidden = rows.slice(COLLAPSED_ROWS)
  const hiddenTicked = hidden.filter((row) => selection.selected.has(row.itemInstanceId)).length

  const selected = [...selection.selected]
  const ticked = selected.length
  const held = selection.actionableCount - ticked
  const failed = plan.rows.filter((row) => row.outcome === "failed").length

  const right = applied
    ? plan.status === "undone"
      ? "Undone"
      : failed > 0
        ? `Applied · ${failed} failed`
        : "Applied"
    : (plan.subtitle ?? (selection.actionableCount > 0 ? `${ticked} moving · ${held} held` : null))

  const confirm = () => {
    // Junk tags and equips are easy to reverse, but a big batch deserves a
    // second look before Ghost starts moving things.
    if (ticked >= 15) {
      Alert.alert(liveLabel(plan.confirmLabel, ticked), `Ghost will act on ${ticked} items.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Go", onPress: () => apply.mutate({ jobId: job.id, selected }) },
      ])
    } else {
      apply.mutate({ jobId: job.id, selected })
    }
  }

  return (
    <Cut cut={12} fill={Ghost.panel} border={Ghost.line} style={{ marginLeft: 14 }}>
      <View style={[styles.between, { padding: 14, paddingBottom: 10 }]}>
        <Mono size={11} color={Ghost.accent}>
          {plan.title}
        </Mono>
        {right ? (
          <Meta color={applied && failed > 0 ? Ghost.danger : Ghost.muted} lines={1}>
            {right}
          </Meta>
        ) : null}
      </View>

      {plan.stats.length > 0 ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          <TierStats stats={plan.stats} />
        </View>
      ) : null}

      {featuredRow ? <Featured plan={plan} row={featuredRow} /> : null}

      {shown.map((row) => (
        <PlanRowView
          key={row.itemInstanceId}
          row={row}
          applied={applied}
          ticked={selection.selected.has(row.itemInstanceId)}
          onToggle={() => selection.toggle(row.itemInstanceId)}
        />
      ))}
      {collapsed ? (
        <Pressable onPress={() => setExpanded(true)} style={styles.more}>
          <Meta>
            {hidden.length} more ·{" "}
            {applied
              ? "tap to show"
              : hiddenTicked === hidden.length
                ? "all moving"
                : `${hiddenTicked} moving`}
          </Meta>
        </Pressable>
      ) : null}

      {plan.note ? (
        <View style={styles.note}>
          <Body size={14} color={Ghost.muted} style={{ lineHeight: 20 }}>
            {plan.note}
          </Body>
        </View>
      ) : null}

      {apply.isError || undo.isError ? (
        <View style={styles.note}>
          <Body size={13} color={Ghost.danger}>
            {errorMessage(apply.error ?? undo.error)}
          </Body>
        </View>
      ) : null}

      <View style={styles.buttons}>
        {plan.status === "proposed" ? (
          <>
            {plan.kind === "weapon" ? (
              <Button
                label={`COMPARE ${plan.rows.length}`}
                under={Ghost.panel}
                onPress={() => onAsk(`Compare those ${plan.rows.length} side by side`)}
              />
            ) : selection.actionableCount > 1 ? (
              <Button
                label={held === selection.actionableCount ? "SELECT ALL" : "HOLD ALL"}
                under={Ghost.panel}
                onPress={() => selection.setAll(held === selection.actionableCount)}
              />
            ) : null}
            <Button
              label={apply.isPending ? "WORKING…" : liveLabel(plan.confirmLabel, ticked)}
              tone={plan.kind === "cleanup" ? "danger" : "solid"}
              flex={1.4}
              under={Ghost.panel}
              disabled={ticked === 0 || apply.isPending}
              onPress={confirm}
            />
          </>
        ) : plan.status === "applied" ? (
          <Button
            label={undo.isPending ? "UNDOING…" : "UNDO"}
            under={Ghost.panel}
            disabled={undo.isPending}
            onPress={() => undo.mutate(job.id)}
          />
        ) : null}
      </View>
    </Cut>
  )
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  rowBody: { flex: 1, gap: 9, paddingVertical: 10 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  more: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  note: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  buttons: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
  },
  perks: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  perk: { paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1 },
})
