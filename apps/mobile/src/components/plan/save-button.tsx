import type { Job, Plan } from '@ghost/contract'
import { router } from 'expo-router'
import { Alert } from 'react-native'

import { Button } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { errorMessage, useSaveBuild, useSavedBuilds } from '@/lib/api'

export const offersSave = (job: Job, plan: Plan) =>
  plan.saveable === true && job.kind !== 'saved_build' && plan.saveTo === undefined

export function SaveButton({ job }: { job: Job }) {
  const builds = useSavedBuilds().data
  const save = useSaveBuild()
  const saved = builds?.find((build) => build.jobId === job.id)
  const revised = builds?.find((build) => build.id === job.buildId)
  if (saved) {
    return (
      <Button
        label={job.buildId === saved.id ? 'UPDATED ›' : 'SAVED ›'}
        tone="accent"
        flex={0.6}
        under={Ghost.panel}
        onPress={() => router.push({ pathname: '/build/[id]', params: { id: saved.id } })}
      />
    )
  }
  if (revised) {
    return (
      <Button
        label={save.isPending ? 'UPDATING…' : 'UPDATE BUILD'}
        flex={0.8}
        under={Ghost.panel}
        disabled={save.isPending}
        onPress={() =>
          save.mutate(
            { jobId: job.id, name: revised.name },
            {
              onError: (error) =>
                Alert.alert(`Couldn't update ${revised.name}`, errorMessage(error)),
            },
          )
        }
      />
    )
  }
  return (
    <Button
      label="SAVE"
      flex={0.6}
      under={Ghost.panel}
      onPress={() => router.push({ pathname: '/save-build', params: { jobId: job.id } })}
    />
  )
}
