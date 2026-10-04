import { router } from "expo-router"
import { useState } from "react"

import { Button, Screen, Section, TextField } from "@/components/native"
import { useCreateJob } from "@/lib/api"

export default function WeaponsScreen() {
  const [weapon, setWeapon] = useState("")
  const createJob = useCreateJob()

  const submit = (extra: string) =>
    createJob.mutate(
      { kind: "weapon_rolls", prompt: `${weapon}. ${extra}`.trim() },
      { onSuccess: (job) => router.push(`/jobs/${job.id}`) },
    )

  const disabled = weapon.trim() === "" || createJob.isPending

  return (
    <Screen>
      <Section
        title="Weapon"
        footer="Name a weapon you own copies of, or a type like 'hand cannon'."
      >
        <TextField placeholder="Fatebringer, Calus Mini-Tool, ..." onChange={setWeapon} />
      </Section>
      <Section title="What to do">
        <Button
          label="Rank my rolls"
          prominent
          disabled={disabled}
          onPress={() => submit("Rank every copy I own by roll quality.")}
        />
        <Button
          label="Find the best PvE roll"
          disabled={disabled}
          onPress={() => submit("Which copy is the best for PvE and why?")}
        />
        <Button
          label="Find the best PvP roll"
          disabled={disabled}
          onPress={() => submit("Which copy is the best for PvP and why?")}
        />
        <Button
          label="List copies to dismantle"
          destructive
          disabled={disabled}
          onPress={() =>
            submit(
              "List the copies with clearly worse rolls that I can dismantle. Do not delete anything.",
            )
          }
        />
      </Section>
    </Screen>
  )
}
