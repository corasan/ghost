import type { Job, Plan } from "@ghost/contract"
import { router } from "expo-router"

import { Button } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { useSavedBuilds } from "@/lib/api"

export const offersSave = (job: Job, plan: Plan) =>
  plan.saveable === true && job.kind !== "saved_build" && plan.saveTo === undefined

export function SaveButton({ job }: { job: Job }) {
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
