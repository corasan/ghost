import type { Job, Plan, PlanRow } from "@ghost/contract"
import { router, useLocalSearchParams } from "expo-router"
import { ScrollView, StyleSheet, View } from "react-native"

import { PlanRowView, useConfirmPlan } from "@/components/chat/plan-block"
import { BuildSections } from "@/components/plan/build-sections"
import { offersSave, SaveButton } from "@/components/plan/save-button"
import { Body, Button, Cond, Meta, Mono } from "@/components/ghost/ui"
import { Ghost, Gutter } from "@/constants/theme"
import { errorMessage, useJob } from "@/lib/api"
import { useFooterHeight } from "@/lib/footer"
import { useBottomInset } from "@/lib/insets"
import { liveLabel } from "@/lib/plan-card"
import { usePlanSelection } from "@/lib/selection"

interface Section {
  readonly label: string
  readonly note: string | null
  readonly rows: ReadonlyArray<PlanRow>
}

// A cleanup plan ticks what Ghost calls junk and leaves review rows unticked,
// so the starting tick is what tells them apart.
const sectionsOf = (plan: Plan): ReadonlyArray<Section> => {
  if (plan.kind !== "cleanup") return [{ label: "ITEMS", note: null, rows: plan.rows }]
  const junk = plan.rows.filter((row) => row.selected)
  const review = plan.rows.filter((row) => !row.selected)
  return [
    { label: `JUNK · ${junk.length}`, note: null, rows: junk },
    {
      label: `REVIEW · ${review.length}`,
      note: "Flagged, but something argues for keeping these. Tick any you want gone.",
      rows: review,
    },
  ].filter((section) => section.rows.length > 0)
}

function ItemRows({ job, plan }: { job: Job; plan: Plan }) {
  const selection = usePlanSelection(job.id, plan)
  const applied = plan.status !== "proposed"
  return (
    <>
      <Cond size={24} style={{ letterSpacing: 0.5, marginBottom: 4 }}>
        {plan.title}
      </Cond>
      {plan.subtitle ? <Meta>{plan.subtitle}</Meta> : null}
      {sectionsOf(plan).map((section) => (
        <View key={section.label} style={{ marginTop: 22 }}>
          <Mono style={{ paddingBottom: 8 }}>{section.label}</Mono>
          {section.note ? <Meta style={{ paddingBottom: 10 }}>{section.note}</Meta> : null}
          {section.rows.map((row) => (
            <PlanRowView
              key={row.itemInstanceId}
              row={row}
              applied={applied}
              ticked={selection.selected.has(row.itemInstanceId)}
              onToggle={() => selection.toggle(row.itemInstanceId)}
              metaLines={0}
            />
          ))}
        </View>
      ))}
    </>
  )
}

function Footer({ job, plan, inset }: { job: Job; plan: Plan; inset: number }) {
  const { selection, apply, ticked, confirm } = useConfirmPlan(job, plan, () => router.back())
  const confirmable = plan.status === "proposed" && selection.actionableCount > 0
  const saveable = offersSave(job, plan)
  if (!confirmable && !saveable) return null
  return (
    <View style={[styles.footer, { paddingBottom: inset + 12 }]}>
      {apply.isError ? (
        <Body size={13} color={Ghost.danger}>
          {errorMessage(apply.error)}
        </Body>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {saveable ? <SaveButton job={job} /> : null}
        {confirmable ? (
          <Button
            label={
              apply.isPending ? "WORKING…" : liveLabel(plan.confirmLabel, ticked).toUpperCase()
            }
            tone={plan.kind === "cleanup" ? "danger" : "solid"}
            under={Ghost.panel}
            disabled={ticked === 0 || apply.isPending}
            onPress={confirm}
          />
        ) : null}
      </View>
    </View>
  )
}

export default function PlanDetailsScreen() {
  const { id, substituted } = useLocalSearchParams<{ id: string; substituted?: string }>()
  const bottomInset = useBottomInset()
  const job = useJob(id)
  const footer = useFooterHeight()
  const plan = job.data?.plan

  if (!job.data || !plan) {
    return (
      <Body color={job.isError ? Ghost.danger : Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {job.isError ? `Couldn't load this plan: ${errorMessage(job.error)}` : "Loading…"}
      </Body>
    )
  }

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: footer.height + 28 }]}>
        {substituted ? (
          <Body size={13} color={Ghost.gold} style={styles.substituted}>
            {`Another copy of ${substituted.split("\n").join(", ")} stands in for the one you saved, which is gone.`}
          </Body>
        ) : null}
        {plan.kind === "build" ? (
          <BuildSections plan={plan} />
        ) : (
          <ItemRows job={job.data} plan={plan} />
        )}
      </ScrollView>
      <View collapsable={false} onLayout={footer.onLayout} style={styles.footerSlot}>
        <Footer job={job.data} plan={plan} inset={bottomInset} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 28 },
  footerSlot: { position: "absolute", left: 0, right: 0, bottom: 0 },
  substituted: { lineHeight: 18, marginBottom: 16 },
  footer: {
    paddingHorizontal: Gutter,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
