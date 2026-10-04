import { router } from "expo-router"

import { Button, Screen, Section } from "@/components/native"
import { useCreateJob } from "@/lib/api"

export default function VaultScreen() {
  const createJob = useCreateJob()

  const start = (kind: "postmaster_to_vault" | "vault_cleanup", prompt: string) =>
    createJob.mutate({ kind, prompt }, { onSuccess: (job) => router.push(`/jobs/${job.id}`) })

  return (
    <Screen>
      <Section
        title="Postmaster"
        footer="Pulls every item from each character's postmaster, then moves it to the vault. Items that were pulled show up under Recently acquired."
      >
        <Button
          label="Send everything to the vault"
          prominent
          disabled={createJob.isPending}
          onPress={() =>
            start("postmaster_to_vault", "Move everything in every postmaster to the vault.")
          }
        />
      </Section>
      <Section title="Cleanup" footer="Nothing is dismantled without a list you approve first.">
        <Button
          label="Find duplicate and worse rolls"
          disabled={createJob.isPending}
          onPress={() =>
            start(
              "vault_cleanup",
              "Find weapons in my vault where I own a strictly better roll of the same weapon, and list the worse copies.",
            )
          }
        />
        <Button
          label="Find armor below my stat floor"
          disabled={createJob.isPending}
          onPress={() =>
            start(
              "vault_cleanup",
              "Find non-exotic armor in my vault with a total stat roll below 60 and list it.",
            )
          }
        />
      </Section>
    </Screen>
  )
}
