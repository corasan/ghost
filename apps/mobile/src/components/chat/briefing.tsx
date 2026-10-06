import type { Briefing, GuardianCharacter } from "@ghost/contract"
import { router } from "expo-router"
import { View } from "react-native"

import { Button, Cond, Meta, Said } from "@/components/ghost/ui"
import { briefingSentence, dayStamp, followUps } from "@/lib/briefing"
import { sentence } from "@/lib/format"

/**
 * The message Ghost opens with: what changed since you last played, and the
 * two most useful next steps. It sits in the conversation where this
 * session begins, so older requests stay above it and new ones below.
 */
export function BriefingView({
  briefing,
  character,
  failed,
  greet,
  onAsk,
}: {
  briefing: Briefing | undefined
  character: GuardianCharacter | undefined
  failed: boolean
  greet: boolean
  onAsk: (prompt: string) => void
}) {
  const who = character
    ? [character.classType, character.subclass].filter(Boolean).map((s) => sentence(String(s)))
    : []
  const said = briefing
    ? briefingSentence(briefing)
    : failed
      ? "I can't reach your Guardian right now. Ask anyway, or pull down later to retry."
      : "Checking what changed since you last played…"
  const next = briefing ? followUps(briefing) : []

  return (
    <View style={{ paddingTop: 8 }}>
      <Meta>{[dayStamp(), ...who].join(" · ")}</Meta>
      {greet ? (
        <Cond size={44} style={{ letterSpacing: 0.4, lineHeight: 42, marginTop: 10 }}>
          {"EYES UP,\nGUARDIAN."}
        </Cond>
      ) : null}
      <View style={{ marginTop: greet ? 28 : 10 }}>
        <Said>{said}</Said>
      </View>
      {next.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14, marginLeft: 14 }}>
          {next.map((step, i) => (
            <Button
              key={step.label}
              label={step.label}
              tone={i === 0 ? "accent" : "outline"}
              flex={0}
              compact
              onPress={() =>
                step.kind === "prompt"
                  ? onAsk(step.prompt)
                  : router.navigate({ pathname: "/recent", params: { filter: step.filter } })
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}
