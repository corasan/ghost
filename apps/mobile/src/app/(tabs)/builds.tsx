import { router } from "expo-router"
import { useState } from "react"

import { Button, Screen, Section, TextField } from "@/components/native"
import { useCreateJob } from "@/lib/api"

export default function BuildsScreen() {
  const [goal, setGoal] = useState("")
  const createJob = useCreateJob()

  const submit = () =>
    createJob.mutate(
      { kind: "build_suggestion", prompt: goal },
      { onSuccess: (job) => router.push(`/jobs/${job.id}`) },
    )

  return (
    <Screen>
      <Section
        title="What do you want the build to do?"
        footer="Ghost looks at the armor and mods you own and proposes a loadout. Example: 100 resilience and 100 discipline on my Warlock for Grandmaster nightfalls."
      >
        <TextField placeholder="Stats, subclass, activity" onChange={setGoal} multiline />
      </Section>
      <Section>
        <Button
          label="Suggest a build"
          prominent
          onPress={submit}
          disabled={goal.trim() === "" || createJob.isPending}
        />
      </Section>
    </Screen>
  )
}
