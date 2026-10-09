import { useQueryClient } from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'

import type { AgentEffort } from '@ghost/contract'

import { Button, Row, Screen, Section, Segmented, TextField } from '@/components/native'
import {
  errorMessage,
  useAgentSettings,
  useBungieAuthStart,
  useHealth,
  useSetAgentEffort,
} from '@/lib/api'
import { setServerToken, setServerUrl, useServerToken, useServerUrl } from '@/lib/server-url'

const EFFORTS: readonly { readonly value: AgentEffort; readonly label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
]

export default function SettingsScreen() {
  const serverUrl = useServerUrl()
  const [draft, setDraft] = useState(serverUrl)
  const serverToken = useServerToken()
  const [tokenDraft, setTokenDraft] = useState('')
  const queryClient = useQueryClient()
  const health = useHealth()
  const authStart = useBungieAuthStart()
  const agent = useAgentSettings()
  const setEffort = useSetAgentEffort()

  const link = () =>
    authStart.mutate(undefined, {
      onSuccess: ({ url }) => WebBrowser.openBrowserAsync(url),
    })

  return (
    <Screen>
      <Section
        title="Server"
        footer="The tailnet address of the machine running the Ghost server, for example https://my-mac.tail1234.ts.net:4848."
      >
        <TextField
          placeholder="https://host.ts.net:4848"
          initialValue={serverUrl}
          onChange={setDraft}
          keyboard="url"
        />
        <Button
          label="Save"
          onPress={() => setServerUrl(draft)}
          disabled={draft.trim() === serverUrl}
        />
      </Section>

      <Section
        title="Pairing token"
        footer="Scanning the QR code from `ghost pair` fills this in. To enter it by hand, run `ghost token` on the server."
      >
        <TextField
          placeholder={
            serverToken === '' ? 'Not paired' : 'Paired; paste a new token to replace it'
          }
          onChange={setTokenDraft}
        />
        <Button
          label="Save"
          onPress={() => {
            setServerToken(tokenDraft)
            void queryClient.invalidateQueries()
          }}
          disabled={tokenDraft.trim() === '' || tokenDraft.trim() === serverToken}
        />
      </Section>

      <Section
        title="Ghost"
        footer="How hard Ghost thinks before answering. Higher effort is more thorough and slower. It applies from your next request."
      >
        <Row
          title="Model"
          detail={agent.data?.model}
          subtitle={
            setEffort.isError
              ? `Couldn't save: ${errorMessage(setEffort.error)}`
              : agent.data
                ? undefined
                : 'Connect to the server first'
          }
        />
        {agent.data ? (
          <Segmented
            options={EFFORTS}
            value={setEffort.variables ?? agent.data.effort}
            onChange={(effort) => setEffort.mutate(effort)}
          />
        ) : null}
      </Section>

      <Section
        title="Bungie account"
        footer="Sign in with Bungie in the browser. The server keeps the tokens; the app never sees them."
      >
        <Row
          title={health.data?.bungieLinked ? 'Linked' : 'Not linked'}
          subtitle={health.data ? undefined : 'Connect to the server first'}
        />
        <Button
          label={health.data?.bungieLinked ? 'Re-link account' : 'Link account'}
          onPress={link}
          disabled={!health.data || authStart.isPending}
        />
      </Section>
    </Screen>
  )
}
