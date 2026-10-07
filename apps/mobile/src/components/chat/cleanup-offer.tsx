import { router } from "expo-router"
import { type ReactNode, useState } from "react"
import { Text, View } from "react-native"

import { Button, Cond, Cut, Meta } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { errorMessage, useCleanup, useCleanupPreview, useStartCleanup } from "@/lib/api"
import { useCharacter } from "@/lib/character"
import { plural } from "@/lib/cleanup"

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 6 }}>
      <Meta>{label}</Meta>
      <Cond size={16} style={{ letterSpacing: 0.7 }}>
        {children}
      </Cond>
    </View>
  )
}

export function CleanupOffer({ characterId }: { characterId: string | null }) {
  const { character } = useCharacter()
  const preview = useCleanupPreview(characterId ?? character?.characterId)
  const running = useCleanup().data
  const start = useStartCleanup()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || !preview.data || preview.data.junk === 0) return null
  const { junk, batches, stash, vault, fits } = preview.data
  const full = vault.after / vault.capacity >= 0.9

  return (
    <Cut border={Ghost.ruleStrong} style={{ marginLeft: 14, padding: 14 }}>
      <View
        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}
      >
        <Cond size={18} style={{ lineHeight: 22 }}>
          CLEAN UP MODE
        </Cond>
        <Meta>{plural(batches, "batch", "batches")}</Meta>
      </View>
      <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: Ghost.rule, paddingTop: 4 }}>
        <Line label="Junk to delete">{junk}</Line>
        <Line label="Stashed first">{stash}</Line>
        <Line label="Vault after">
          <Text style={{ color: Ghost.dim }}>{vault.count} → </Text>
          <Text style={{ color: full ? Ghost.danger : Ghost.ink }}>{vault.after}</Text>
          <Text style={{ color: Ghost.dim }}> / {vault.capacity}</Text>
        </Line>
      </View>
      {!fits ? (
        <Meta color={Ghost.danger} style={{ marginTop: 10 }}>
          The vault can’t hold what you carry. Make room first.
        </Meta>
      ) : start.isError ? (
        <Meta color={Ghost.danger} style={{ marginTop: 10 }}>
          {errorMessage(start.error)}
        </Meta>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
        {running ? (
          <Button
            label="OPEN CLEANUP"
            tone="solid"
            compact
            onPress={() => router.navigate("/cleanup")}
          />
        ) : (
          <>
            <Button label="NOT NOW" compact onPress={() => setDismissed(true)} />
            <Button
              label={start.isPending ? "STARTING…" : "START CLEANUP"}
              tone="solid"
              flex={1.4}
              compact
              disabled={!fits || start.isPending}
              onPress={() =>
                start.mutate(preview.data.characterId, {
                  onSuccess: () => router.navigate("/cleanup"),
                })
              }
            />
          </>
        )}
      </View>
    </Cut>
  )
}
