import type { Job, JobStep } from "@ghost/contract"
import { useEffect, useRef, useState } from "react"
import { Animated, Pressable, View } from "react-native"

import { Body, Chevron, Meta } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
const line = (step: JobStep) => (step.detail ? `${step.label} · ${step.detail}` : step.label)

function StepLines({ steps }: { steps: readonly JobStep[] }) {
  return (
    <View style={{ gap: 5 }}>
      {steps.map((step, i) => (
        <Meta key={i} lines={1}>
          {line(step)}
        </Meta>
      ))}
    </View>
  )
}

function Pulse({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={{ opacity }}>{children}</Animated.View>
}

/**
 * What Ghost is doing right now: only the latest tool call. The detail line is
 * always laid out so the block keeps one height while an answer is on its way.
 */
export function Working({ job }: { job: Job }) {
  const current = job.steps[job.steps.length - 1]
  const now =
    job.status === "queued" ? "Queued" : current === undefined ? "Thinking" : current.label
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 2, backgroundColor: Ghost.accent }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Pulse>
          <Body size={16} color={Ghost.muted} lines={1}>
            {now}…
          </Body>
          <Meta style={{ marginTop: 2 }} lines={1}>
            {current?.detail ?? " "}
          </Meta>
        </Pulse>
      </View>
    </View>
  )
}

/** After the answer: how many tools it took, expandable to the calls themselves. */
export function StepsSummary({ steps }: { steps: readonly JobStep[] }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null
  return (
    <View style={{ marginLeft: 14, gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" }}
      >
        <Meta>
          {steps.length} {steps.length === 1 ? "tool call" : "tool calls"}
        </Meta>
        <View style={{ marginTop: open ? -3 : 0 }}>
          <Chevron size={5} direction={open ? "down" : "right"} />
        </View>
      </Pressable>
      {open ? <StepLines steps={steps} /> : null}
    </View>
  )
}
