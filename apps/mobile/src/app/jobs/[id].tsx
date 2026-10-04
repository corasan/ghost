import { Stack, useLocalSearchParams } from "expo-router"

import { Empty, Row, Screen, Section, Spinner } from "@/components/native"
import { useJob } from "@/lib/api"
import { kindLabel, relativeTime, statusLabel } from "@/lib/format"

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const job = useJob(id)

  if (job.data === undefined) {
    return (
      <Screen>
        <Section>
          {job.isError ? <Empty title="Task not found" /> : <Spinner label="Loading" />}
        </Section>
      </Screen>
    )
  }

  const data = job.data
  const settled = data.status === "done" || data.status === "failed"

  return (
    <>
      <Stack.Screen options={{ title: kindLabel[data.kind] }} />
      <Screen onRefresh={job.refetch}>
        <Section title="Request">
          <Row title={data.prompt} />
        </Section>
        <Section title="Status">
          <Row title={statusLabel[data.status]} detail={relativeTime(data.updatedAt)} />
          {!settled ? <Spinner label="Ghost is working" /> : null}
        </Section>
        {data.result ? (
          <Section title="Result">
            <Row title={data.result} />
          </Section>
        ) : null}
        {data.error ? (
          <Section title="Error">
            <Row title={data.error} />
          </Section>
        ) : null}
      </Screen>
    </>
  )
}
