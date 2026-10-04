import { router } from "expo-router"

import { Empty, Row, Screen, Section, Spinner } from "@/components/native"
import { useJobs } from "@/lib/api"
import { kindLabel, relativeTime, statusLabel } from "@/lib/format"

export default function ActivityScreen() {
  const jobs = useJobs()

  return (
    <Screen onRefresh={jobs.refetch}>
      <Section title="Tasks">
        {jobs.data === undefined ? (
          <Spinner />
        ) : jobs.data.length === 0 ? (
          <Empty title="No tasks yet" description="Anything you ask Ghost to do shows up here." />
        ) : (
          jobs.data.map((job) => (
            <Row
              key={job.id}
              title={kindLabel[job.kind]}
              subtitle={`${statusLabel[job.status]} · ${relativeTime(job.createdAt)}`}
              onPress={() => router.push(`/jobs/${job.id}`)}
            />
          ))
        )}
      </Section>
    </Screen>
  )
}
