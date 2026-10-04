import * as WebBrowser from "expo-web-browser"
import { useState } from "react"

import { Button, Row, Screen, Section, TextField } from "@/components/native"
import { useBungieAuthStart, useHealth } from "@/lib/api"
import { setServerUrl, useServerUrl } from "@/lib/server-url"

export default function SettingsScreen() {
  const serverUrl = useServerUrl()
  const [draft, setDraft] = useState(serverUrl)
  const health = useHealth()
  const authStart = useBungieAuthStart()

  const link = () =>
    authStart.mutate(undefined, {
      onSuccess: ({ url }) => WebBrowser.openBrowserAsync(url),
    })

  return (
    <Screen>
      <Section
        title="Server"
        footer="The tailnet address of the machine running the Ghost server, for example http://my-mac.tail1234.ts.net:4848."
      >
        <TextField
          placeholder="http://host:4848"
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
        title="Bungie account"
        footer="Sign in with Bungie in the browser. The server keeps the tokens; the app never sees them."
      >
        <Row
          title={health.data?.bungieLinked ? "Linked" : "Not linked"}
          subtitle={health.data ? undefined : "Connect to the server first"}
        />
        <Button
          label={health.data?.bungieLinked ? "Re-link account" : "Link account"}
          onPress={link}
          disabled={!health.data || authStart.isPending}
        />
      </Section>
    </Screen>
  )
}
