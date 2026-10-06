import type {
  GuardianClass,
  Job,
  LoadoutPlug,
  Plan,
  SubclassLoadout,
  PlanRow,
} from "@ghost/contract"
import { router } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { ItemIcon } from "@/components/ghost/item-icon"
import { PlugIcon } from "@/components/ghost/plug-icon"
import { SetBonusIcons } from "@/components/ghost/set-bonus"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { Body, Button, Cond, Cut, Meta, Mono } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { errorMessage, useApplyPlan, useUndoPlan } from "@/lib/api"
import { orderBuildStats } from "@/lib/build-order"
import { sentence } from "@/lib/format"
import {
  appliedTotals,
  bySlot,
  failures,
  hasStatMods,
  headline,
  litTicks,
  type ModPip,
  modPips,
  pendingMasterwork,
  shortPlugName,
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
  eyebrowSize = 11,
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

type Shown = { name: string; icon: string | null; swap?: boolean | undefined }

function Plugs({ plugs }: { plugs: readonly Shown[] }) {
  return (
    <View style={styles.plugs}>
      {plugs.map((plug) => (
        <View key={plug.name} style={styles.plug}>
          <PlugIcon icon={plug.icon} size={16} />
          <Body size={13} color={plug.swap ? Ghost.accent : Ghost.soft} style={{ lineHeight: 17 }}>
            {plug.name}
          </Body>
        </View>
      ))}
    </View>
  )
}

const shown = (plug: LoadoutPlug, name = plug.name): Shown => ({
  name,
  icon: plug.icon ?? null,
  swap: plug.swap,
})

function Loadout({ loadout }: { loadout: SubclassLoadout }) {
  const replaces = loadout.change?.replaces
  const lines = [
    {
      label: "Subclass",
      plugs: replaces
        ? [
            {
              name: `${loadout.subclass} · replaces ${replaces}`,
              icon: loadout.icon ?? null,
              swap: true,
            },
          ]
        : [],
    },
    { label: "Super", plugs: loadout.super ? [shown(loadout.super)] : [] },
    { label: "Aspects", plugs: loadout.aspects.map((aspect) => shown(aspect)) },
    {
      label: "Fragments",
      plugs: loadout.fragments.map((each) => shown(each, shortPlugName(each.name))),
    },
  ].filter((line) => line.plugs.length > 0)
  if (lines.length === 0) return null
  return (
    <View style={{ marginTop: 14, gap: 7 }}>
      {lines.map((line) => (
        <View key={line.label} style={styles.loadoutLine}>
          <Meta style={styles.loadoutLabel}>{line.label}</Meta>
          <Plugs plugs={line.plugs} />
        </View>
      ))}
    </View>
  )
}

function Stats({ plan }: { plan: Plan }) {
  const applied = appliedTotals(plan)
  return (
    <View style={styles.band}>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {orderBuildStats(plan.stats).map((stat) => {
          const tone = stat.target ? Ghost.good : Ghost.ink
          return (
            <View key={stat.label} style={{ flex: 1 }}>
              <Cond size={24} color={tone} style={{ letterSpacing: 0, lineHeight: 24 }}>
                {stat.value}
              </Cond>
              <Meta size={12} style={{ marginTop: 3 }} lines={1}>
                {sentence(stat.label)}
              </Meta>
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
        <Meta style={{ marginTop: 10 }}>
          {hasStatMods(plan) ? "Fragments and mods applied" : "Fragments applied"}
          {applied.map((mod) => (
            <Text key={mod.label}>
              {" · "}
              <Text style={{ color: mod.delta > 0 ? Ghost.good : Ghost.danger }}>
                {signed(mod.delta)} {sentence(mod.label)}
              </Text>
            </Text>
          ))}
        </Meta>
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
  const failed = failures(plan)
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
 * A build in bands: the subclass it sits on, the six stats it lands on, the
 * pieces as tiles, the set bonuses they turn on, and one line saying what
 * confirming will do.
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
  loadoutLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  loadoutLabel: { width: 72, marginTop: 4 },
  plugs: { flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 6 },
  plug: { flexDirection: "row", alignItems: "center", gap: 6 },
  band: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: Ghost.rule },
  verdict: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12 },
  action: { flexDirection: "row", marginTop: 12 },
})
