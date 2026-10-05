import type { GuardianClass, Job, Plan, SubclassLoadout, PlanRow } from "@ghost/contract"
import { router } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { ItemIcon } from "@/components/ghost/item-icon"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { Body, Button, Cond, Cut, Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { errorMessage, useApplyPlan, useUndoPlan } from "@/lib/api"
import { orderBuildStats } from "@/lib/build-order"
import {
  appliedTotals,
  bySlot,
  hasStatMods,
  headline,
  litTicks,
  type ModPip,
  modPips,
  pendingMasterwork,
  shortPlugName,
  shortStat,
  signed,
  slotLabel,
  STAT_TICKS,
  verdict,
} from "@/lib/plan-card"
import { usePlanSelection } from "@/lib/selection"

const TILES_PER_ROW = 5

const upper = (parts: ReadonlyArray<string | null | undefined>) =>
  parts
    .filter((part) => part)
    .join(" · ")
    .toUpperCase()

export function BuildHeader({
  eyebrow,
  plan,
  eyebrowSize = 9,
}: {
  eyebrow: string
  plan: Plan
  eyebrowSize?: number
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Mono size={eyebrowSize} style={{ letterSpacing: eyebrowSize * 0.14 }} lines={1}>
          {eyebrow}
        </Mono>
        <Cond size={30} style={{ letterSpacing: 0.6, lineHeight: 30, marginTop: 7 }}>
          {headline(plan)}
        </Cond>
      </View>
      {plan.loadout ? <SubclassMark loadout={plan.loadout} size={36} /> : null}
    </View>
  )
}

function Dotted({ names }: { names: readonly string[] }) {
  return (
    <Body size={14} color={Ghost.soft} style={{ flex: 1, lineHeight: 19 }}>
      {names.map((name, i) => (
        <Text key={name}>
          {i > 0 ? <Text style={{ color: Ghost.dim }}> · </Text> : null}
          {name}
        </Text>
      ))}
    </Body>
  )
}

function Loadout({ loadout }: { loadout: SubclassLoadout }) {
  const lines = [
    { label: "SUPER", names: loadout.super ? [loadout.super.name] : [] },
    { label: "ASPECTS", names: loadout.aspects.map((aspect) => aspect.name) },
    { label: "FRAGMENTS", names: loadout.fragments.map((each) => shortPlugName(each.name)) },
  ].filter((line) => line.names.length > 0)
  if (lines.length === 0) return null
  return (
    <View style={{ marginTop: 14, gap: 7 }}>
      {lines.map((line) => (
        <View key={line.label} style={styles.loadoutLine}>
          <Mono style={{ width: 72 }}>{line.label}</Mono>
          {line.label === "SUPER" ? (
            <Body size={14} style={{ flex: 1, fontFamily: Type.bodyMedium, lineHeight: 19 }}>
              {line.names[0]}
            </Body>
          ) : (
            <Dotted names={line.names} />
          )}
        </View>
      ))}
    </View>
  )
}

function Stats({ plan }: { plan: Plan }) {
  const applied = appliedTotals(plan)
  return (
    <View style={styles.band}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {orderBuildStats(plan.stats).map((stat) => {
          const tone = stat.target ? Ghost.good : Ghost.ink
          return (
            <View key={stat.label} style={{ flex: 1 }}>
              <Cond size={24} color={tone} style={{ letterSpacing: 0, lineHeight: 24 }}>
                {stat.value}
              </Cond>
              <Mono size={8} style={{ marginTop: 4, letterSpacing: 0.8 }} lines={1}>
                {stat.label}
              </Mono>
              <View style={{ flexDirection: "row", gap: 2, marginTop: 6 }}>
                {Array.from({ length: STAT_TICKS }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 3,
                      backgroundColor: i < litTicks(stat.value) ? tone : Ghost.line,
                    }}
                  />
                ))}
              </View>
            </View>
          )
        })}
      </View>
      {applied.length > 0 ? (
        <Mono style={{ marginTop: 8, letterSpacing: 0.9 }}>
          {hasStatMods(plan) ? "FRAGMENTS + MODS APPLIED" : "FRAGMENTS APPLIED"}
          {applied.map((mod) => (
            <Text key={mod.label}>
              {" · "}
              <Text style={{ color: mod.delta > 0 ? Ghost.good : Ghost.danger }}>
                {signed(mod.delta)} {shortStat(mod.label)}
              </Text>
            </Text>
          ))}
        </Mono>
      ) : null}
    </View>
  )
}

const PIP_OTHER = "#7b828d"

/** A piece's mod sockets at a glance: blue for a mod the plan puts in, white for a stat mod, grey for any other, hollow for a free slot. */
export function ModPips({ pips, fill = false }: { pips: readonly ModPip[]; fill?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {pips.map((pip, i) => {
        const tone = {
          swap: Ghost.accent,
          stat: Ghost.ink,
          other: PIP_OTHER,
          free: Ghost.ruleStrong,
        }[pip]
        return (
          <View
            key={i}
            style={{
              flex: fill ? 1 : undefined,
              width: fill ? undefined : 10,
              height: 5,
              borderWidth: 1,
              borderColor: tone,
              backgroundColor: pip === "free" ? undefined : tone,
            }}
          />
        )
      })}
    </View>
  )
}

const outcomeLabel = { ok: null, failed: "FAILED", skipped: "HELD" } as const

function Tile({
  row,
  applied,
  classType,
}: {
  row: PlanRow
  applied: boolean
  classType: GuardianClass | undefined
}) {
  const arriving = !applied && row.origin !== undefined && row.action !== "none"
  const result = applied && row.outcome ? outcomeLabel[row.outcome] : null
  const pips = modPips(row)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.name}
      accessibilityHint="Opens item details"
      onPress={() => router.push({ pathname: "/item/[id]", params: { id: row.itemInstanceId } })}
      style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.6 }]}
    >
      <View style={arriving ? { boxShadow: `0 0 0 1px ${Ghost.accent}` } : undefined}>
        <ItemIcon
          icon={row.icon}
          size={58}
          fill
          element={row.damageType}
          gearTier={row.gearTier}
          masterwork={row.masterwork}
          power={row.power}
        />
      </View>
      {pips ? (
        <View style={{ marginTop: 6 }}>
          <ModPips pips={pips} fill />
        </View>
      ) : null}
      <Mono
        size={8}
        color={result ? Ghost.danger : arriving ? Ghost.accent : Ghost.dim}
        style={{ letterSpacing: 0.8, marginTop: 6 }}
        lines={1}
      >
        {result ?? (arriving ? row.origin : slotLabel(row.slot, classType))}
      </Mono>
    </Pressable>
  )
}

function Tiles({ plan, applied }: { plan: Plan; applied: boolean }) {
  const rows = bySlot(plan.rows)
  const lines = Array.from({ length: Math.ceil(rows.length / TILES_PER_ROW) }, (_, i) =>
    rows.slice(i * TILES_PER_ROW, (i + 1) * TILES_PER_ROW),
  )
  return (
    <View style={[styles.band, { gap: 12 }]}>
      {lines.map((line, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          {line.map((row) => (
            <Tile
              key={row.itemInstanceId}
              row={row}
              applied={applied}
              classType={plan.loadout?.classType}
            />
          ))}
          {Array.from({ length: TILES_PER_ROW - line.length }, (_, pad) => (
            <View key={pad} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  )
}

function Verdict({ plan }: { plan: Plan }) {
  const failed = plan.rows.filter((row) => row.outcome === "failed").length
  const pending = pendingMasterwork(plan)
  const outcome = verdict(plan)
  if (plan.status === "undone") return <>Undone.</>
  if (plan.status === "applied") {
    return failed > 0 ? (
      <>
        Applied. <Text style={{ color: Ghost.danger }}>{failed} failed.</Text>
      </>
    ) : (
      <>Applied.</>
    )
  }
  return (
    <>
      {outcome.plain}
      {outcome.change ? (
        <Text style={{ color: Ghost.accent }}>
          {outcome.plain ? " " : ""}
          {outcome.change}
        </Text>
      ) : null}
      {pending > 0 ? <Text style={{ color: Ghost.gold }}> {pending} not masterworked.</Text> : null}
    </>
  )
}

/**
 * A build in four bands: the subclass it sits on, the six stats it lands on,
 * the pieces as tiles, and one line saying what confirming will do.
 */
export function BuildCard({ job, plan }: { job: Job; plan: Plan }) {
  const selection = usePlanSelection(job.id, plan)
  const apply = useApplyPlan()
  const undo = useUndoPlan()
  const selected = [...selection.selected]
  const applied = plan.status !== "proposed"

  return (
    <Cut cut={10} fill={Ghost.panel} border={Ghost.line} style={styles.card}>
      <BuildHeader
        plan={plan}
        eyebrow={upper(["Build plan", plan.loadout?.classType, plan.loadout?.subclass])}
      />
      {plan.loadout ? <Loadout loadout={plan.loadout} /> : null}
      <Stats plan={plan} />
      <Tiles plan={plan} applied={applied} />

      <View style={[styles.band, styles.verdict]}>
        <Body size={14} color={Ghost.soft} style={{ flex: 1, lineHeight: 19 }}>
          <Verdict plan={plan} />
        </Body>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Build details"
          hitSlop={10}
          onPress={() => router.push({ pathname: "/plan/[id]", params: { id: job.id } })}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Cond size={14} color={Ghost.accent}>
            DETAILS ›
          </Cond>
        </Pressable>
      </View>

      {apply.isError || undo.isError ? (
        <Body size={13} color={Ghost.danger} style={{ marginTop: 10 }}>
          {errorMessage(apply.error ?? undo.error)}
        </Body>
      ) : null}

      {plan.status === "proposed" && selection.actionableCount > 0 ? (
        <View style={styles.action}>
          <Button
            label={apply.isPending ? "WORKING…" : plan.confirmLabel.toUpperCase()}
            tone="solid"
            under={Ghost.panel}
            disabled={selected.length === 0 || apply.isPending}
            onPress={() => apply.mutate({ jobId: job.id, selected })}
          />
        </View>
      ) : plan.status === "applied" ? (
        <View style={styles.action}>
          <Button
            label={undo.isPending ? "UNDOING…" : "UNDO"}
            under={Ghost.panel}
            disabled={undo.isPending}
            onPress={() => undo.mutate(job.id)}
          />
        </View>
      ) : null}
    </Cut>
  )
}

const styles = StyleSheet.create({
  card: { marginLeft: 14, padding: 16, paddingTop: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  loadoutLine: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  band: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Ghost.rule },
  verdict: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12 },
  action: { flexDirection: "row", marginTop: 12 },
})
