import type { GuardianClass, Job, Plan, PlanRow } from "@ghost/contract"
import { router } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { ItemIcon } from "@/components/ghost/item-icon"
import { SetBonusIcons } from "@/components/ghost/set-bonus"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { offersSave, SaveButton } from "@/components/plan/save-button"
import { Body, Button, Cond, Cut, Meta, Mono, StatIcon } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { errorMessage, useApplyPlan, useUndoPlan } from "@/lib/api"
import { orderBuildStats } from "@/lib/build-order"
import { sentence } from "@/lib/format"
import {
  appliedTotals,
  failures,
  hasStatMods,
  headline,
  type ModPip,
  pendingMasterwork,
  signed,
  slotLabel,
  splitRows,
  statTicks,
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
  eyebrowSize = 11,
  name,
}: {
  eyebrow: string
  plan: Plan
  eyebrowSize?: number
  name?: string | undefined
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Mono size={eyebrowSize} style={{ letterSpacing: eyebrowSize * 0.14 }} lines={1}>
          {eyebrow}
        </Mono>
        <Cond size={30} style={{ letterSpacing: 0.6, lineHeight: 30, marginTop: 7 }} lines={2}>
          {name?.toUpperCase() ?? headline(plan)}
        </Cond>
      </View>
      {plan.loadout ? <SubclassMark loadout={plan.loadout} size={36} /> : null}
    </View>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 8, height: 3, backgroundColor: color }} />
      <Meta size={12} color={Ghost.dim}>
        {label}
      </Meta>
    </View>
  )
}

function Stats({ plan }: { plan: Plan }) {
  const applied = appliedTotals(plan)
  const added = new Map(applied.map((mod) => [mod.label, mod.delta]))
  return (
    <View style={styles.band}>
      <View style={styles.statGrid}>
        {orderBuildStats(plan.stats).map((stat) => {
          const tone = stat.target ? Ghost.accent : Ghost.ink
          const delta = added.get(stat.label) ?? 0
          return (
            <View key={stat.label} style={styles.stat}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <StatIcon
                  label={stat.label}
                  size={22}
                  color={stat.target ? Ghost.accent : Ghost.muted}
                />
                <Meta color={stat.target ? Ghost.accent : Ghost.dim} lines={1}>
                  {sentence(stat.label)}
                </Meta>
              </View>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Cond size={22} color={tone} style={{ letterSpacing: 0, lineHeight: 22 }}>
                  {stat.value}
                </Cond>
                {delta !== 0 ? (
                  <Mono size={10} color={delta > 0 ? Ghost.good : Ghost.danger}>
                    {signed(delta)}
                  </Mono>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 2 }}>
                {statTicks(stat.value, delta).map((tick, i) => (
                  <View key={i} style={styles.tick}>
                    <View style={{ flex: tick.base, backgroundColor: tone }} />
                    <View style={{ flex: tick.added, backgroundColor: Ghost.good }} />
                    <View style={{ flex: 1 - tick.base - tick.added }} />
                  </View>
                ))}
              </View>
            </View>
          )
        })}
      </View>
      <View style={styles.legend}>
        <Swatch color={Ghost.ink} label="Base" />
        {applied.length > 0 ? (
          <Swatch color={Ghost.good} label={hasStatMods(plan) ? "Fragments + mods" : "Fragments"} />
        ) : null}
        {plan.stats.some((stat) => stat.target) ? (
          <Swatch color={Ghost.accent} label="Asked for" />
        ) : null}
      </View>
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
      <Meta
        size={12}
        color={result ? Ghost.danger : arriving ? Ghost.accent : Ghost.dim}
        style={{ marginTop: 5 }}
        lines={1}
      >
        {result ?? (arriving && row.origin ? sentence(row.origin) : slotLabel(row.slot, classType))}
      </Meta>
    </Pressable>
  )
}

function Tiles({
  rows,
  classType,
  applied,
}: {
  rows: readonly PlanRow[]
  classType: GuardianClass | undefined
  applied: boolean
}) {
  const lines = Array.from({ length: Math.ceil(rows.length / TILES_PER_ROW) }, (_, i) =>
    rows.slice(i * TILES_PER_ROW, (i + 1) * TILES_PER_ROW),
  )
  return (
    <View style={[styles.band, { gap: 12 }]}>
      {lines.map((line, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          {line.map((row) => (
            <Tile key={row.itemInstanceId} row={row} applied={applied} classType={classType} />
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
  const failed = failures(plan)
  const pending = pendingMasterwork(plan)
  const outcome = verdict(plan)
  const toSelect =
    plan.artifact?.picks.filter((pick) => pick.state === "select_in_game").length ?? 0
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
      {toSelect > 0 ? (
        <Text style={{ color: Ghost.gold }}> {toSelect} artifact perks to select in game.</Text>
      ) : null}
    </>
  )
}

export function BuildCard({ job, plan }: { job: Job; plan: Plan }) {
  const selection = usePlanSelection(job.id, plan)
  const apply = useApplyPlan()
  const undo = useUndoPlan()
  const selected = [...selection.selected]
  const applied = plan.status !== "proposed"
  const confirmable = plan.status === "proposed" && selection.actionableCount > 0
  const saveable = offersSave(job, plan)
  const { pieces, weapons } = splitRows(plan.rows)

  return (
    <Cut cut={10} fill={Ghost.panel} border={Ghost.line} style={styles.card}>
      <BuildHeader
        plan={plan}
        eyebrow={upper(["Build plan", plan.loadout?.classType, plan.loadout?.subclass])}
      />
      <Stats plan={plan} />
      {plan.rows.length > 0 ? (
        <Tiles
          rows={[...pieces, ...weapons]}
          classType={plan.loadout?.classType}
          applied={applied}
        />
      ) : null}
      {plan.setBonuses?.length ? (
        <View style={styles.band}>
          <SetBonusIcons bonuses={plan.setBonuses} />
        </View>
      ) : null}

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

      {saveable || confirmable || plan.status === "applied" ? (
        <View style={styles.action}>
          {saveable ? <SaveButton job={job} /> : null}
          {confirmable ? (
            <Button
              label={apply.isPending ? "WORKING…" : plan.confirmLabel.toUpperCase()}
              tone="solid"
              under={Ghost.panel}
              disabled={selected.length === 0 || apply.isPending}
              onPress={() => apply.mutate({ jobId: job.id, selected })}
            />
          ) : plan.status === "applied" ? (
            <Button
              label={undo.isPending ? "UNDOING…" : "UNDO"}
              under={Ghost.panel}
              disabled={undo.isPending}
              onPress={() => undo.mutate(job.id)}
            />
          ) : null}
        </View>
      ) : null}
    </Cut>
  )
}

const styles = StyleSheet.create({
  card: { marginLeft: 14, padding: 16, paddingTop: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  band: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Ghost.rule },
  statGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 18 },
  stat: { width: "29%", flexGrow: 1, gap: 6 },
  tick: { flex: 1, height: 4, flexDirection: "row", backgroundColor: Ghost.line },
  legend: {
    flexDirection: "row",
    gap: 14,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  verdict: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12 },
  action: { flexDirection: "row", gap: 8, marginTop: 12 },
})
