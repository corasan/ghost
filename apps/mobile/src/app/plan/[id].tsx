import type { Job, Plan } from "@ghost/contract"
import { router, useLocalSearchParams } from "expo-router"
import { ScrollView, StyleSheet, View } from "react-native"

import { BuildSections } from "@/components/plan/build-sections"
import { Body, Button } from "@/components/ghost/ui"
import { Ghost, Gutter } from "@/constants/theme"
import { errorMessage, useApplyPlan, useJob, useSavedBuilds } from "@/lib/api"
import { useFooterHeight } from "@/lib/footer"
import { useBottomInset } from "@/lib/insets"
import { usePlanSelection } from "@/lib/selection"

/** A build Ghost proposed can be saved; one equipped from Builds is already saved. */
const offersSave = (job: Job, plan: Plan) =>
  plan.saveable === true && job.kind !== "saved_build" && plan.saveTo === undefined

function Save({ job }: { job: Job }) {
  const saved = useSavedBuilds().data?.find((build) => build.jobId === job.id)
  return saved ? (
    <Button
      label="SAVED ›"
      tone="accent"
      flex={0.6}
      under={Ghost.panel}
      onPress={() => router.push({ pathname: "/build/[id]", params: { id: saved.id } })}
    />
  ) : (
    <Button
      label="SAVE"
      flex={0.6}
      under={Ghost.panel}
      onPress={() => router.push({ pathname: "/save-build", params: { jobId: job.id } })}
    />
  )
}

function Footer({ job, plan, inset }: { job: Job; plan: Plan; inset: number }) {
  const selection = usePlanSelection(job.id, plan)
  const apply = useApplyPlan()
  const selected = [...selection.selected]
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
        {saveable ? <Save job={job} /> : null}
        {confirmable ? (
          <Button
            label={apply.isPending ? "WORKING…" : plan.confirmLabel.toUpperCase()}
            tone="solid"
            under={Ghost.panel}
            disabled={selected.length === 0 || apply.isPending}
            onPress={() =>
              apply.mutate({ jobId: job.id, selected }, { onSuccess: () => router.back() })
            }
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
        {job.isError ? `Couldn't load this build: ${errorMessage(job.error)}` : "Loading…"}
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
        <BuildSections plan={plan} />
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
