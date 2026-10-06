import type { Job, Plan } from "@ghost/contract"
import { router, useLocalSearchParams } from "expo-router"
import { ScrollView, StyleSheet, View } from "react-native"

import { BuildSections } from "@/components/plan/build-sections"
import { Body, Button } from "@/components/ghost/ui"
import { Ghost, Gutter } from "@/constants/theme"
import { errorMessage, useApplyPlan, useJob } from "@/lib/api"
import { useFooterHeight } from "@/lib/footer"
import { useBottomInset } from "@/lib/insets"
import { usePlanSelection } from "@/lib/selection"

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
          label={apply.isPending ? "WORKING…" : plan.confirmLabel.toUpperCase()}
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

export default function PlanDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
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
        <BuildSections plan={plan} />
      </ScrollView>
      <View collapsable={false} onLayout={footer.onLayout} style={styles.footerSlot}>
        <Confirm job={job.data} plan={plan} inset={bottomInset} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 28 },
  footerSlot: { position: "absolute", left: 0, right: 0, bottom: 0 },
  footer: {
    paddingHorizontal: Gutter,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
