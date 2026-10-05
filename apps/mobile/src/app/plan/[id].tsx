import { useLocalSearchParams } from "expo-router"
import { ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BuildStats } from "@/components/chat/build-stats"
import { PlanRowView } from "@/components/chat/plan-block"
import { Body, Cond, Mono } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { errorMessage, useJob } from "@/lib/api"

/**
 * Everything about a build the chat card leaves out: what each stat does
 * and where it lands, and every piece with its stats and masterwork values.
 */
export default function PlanDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const job = useJob(id)
  const plan = job.data?.plan

  if (!plan) {
    return (
      <Body color={job.isError ? Ghost.danger : Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {job.isError ? `Couldn't load this build: ${errorMessage(job.error)}` : "Loading…"}
      </Body>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 28, paddingBottom: insets.bottom + 20 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
        <Cond size={24} style={{ letterSpacing: 0.5, lineHeight: 26 }}>
          {plan.title.toUpperCase()}
        </Cond>
        {plan.subtitle ? (
          <Mono size={10} style={{ marginTop: 6, lineHeight: 15 }}>
            {plan.subtitle}
          </Mono>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 6 }}>
        <BuildStats stats={plan.stats} />
      </View>
      <Mono style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>PIECES</Mono>
      {plan.rows.map((row) => (
        <PlanRowView
          key={row.itemInstanceId}
          row={row}
          ticked
          applied={plan.status !== "proposed"}
          inset={20}
          detailed
        />
      ))}
      {plan.note ? (
        <Body
          size={13}
          color={Ghost.muted}
          style={{ lineHeight: 18, paddingHorizontal: 20, paddingTop: 16 }}
        >
          {plan.note}
        </Body>
      ) : null}
    </ScrollView>
  )
}
