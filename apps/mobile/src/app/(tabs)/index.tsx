import { router } from "expo-router"

import { Button, Empty, Row, Screen, Section, Spinner } from "@/components/native"
import { useCreateJob, useHealth, useJobs, useRecentItems } from "@/lib/api"
import { kindLabel, relativeTime, statusLabel } from "@/lib/format"
import { useServerUrl } from "@/lib/server-url"

export default function HomeScreen() {
  const serverUrl = useServerUrl()
  const health = useHealth()
  const recent = useRecentItems()
  const jobs = useJobs()
  const createJob = useCreateJob()

  const active =
    jobs.data?.filter((job) => job.status === "queued" || job.status === "running") ?? []

  const quick = (kind: "postmaster_to_vault" | "vault_cleanup", prompt: string) =>
    createJob.mutate({ kind, prompt }, { onSuccess: (job) => router.push(`/jobs/${job.id}`) })

  return (
    <Screen onRefresh={() => Promise.all([health.refetch(), recent.refetch(), jobs.refetch()])}>
      <Section title="Server" footer={serverUrl}>
        {health.isPending ? (
          <Spinner label="Connecting" />
        ) : health.data ? (
          <Row
            title="Connected"
            subtitle={
              health.data.bungieLinked ? "Bungie account linked" : "Bungie account not linked"
            }
            detail={health.data.version}
            onPress={() => router.push("/settings")}
          />
        ) : (
          <Row
            title="Unreachable"
            subtitle="Check the server URL"
            onPress={() => router.push("/settings")}
          />
        )}
      </Section>

      <Section title="Quick actions">
        <Button
          label="Send postmaster to vault"
          onPress={() =>
            quick("postmaster_to_vault", "Move everything in every postmaster to the vault.")
          }
          disabled={createJob.isPending}
        />
        <Button
          label="Suggest vault cleanup"
          onPress={() =>
            quick("vault_cleanup", "Find vault items I can safely dismantle and list them.")
          }
          disabled={createJob.isPending}
        />
      </Section>

      {active.length > 0 ? (
        <Section title="In progress">
          {active.map((job) => (
            <Row
              key={job.id}
              title={kindLabel[job.kind]}
              subtitle={job.prompt}
              detail={statusLabel[job.status]}
              onPress={() => router.push(`/jobs/${job.id}`)}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Recently acquired" footer="Items Ghost moved for you, newest first.">
        {recent.data === undefined ? (
          <Spinner />
        ) : recent.data.length === 0 ? (
          <Empty
            title="Nothing yet"
            description="Pull from the postmaster and new items show up here."
          />
        ) : (
          recent.data.map((item) => (
            <Row
              key={item.itemInstanceId}
              title={item.name ?? `Item ${item.itemHash}`}
              subtitle={item.location}
              detail={relativeTime(item.firstSeenAt)}
            />
          ))
        )}
      </Section>
    </Screen>
  )
}
