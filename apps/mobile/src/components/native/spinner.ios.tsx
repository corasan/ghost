import { ProgressView, Text } from "@expo/ui/swift-ui"
import type { SpinnerProps } from "./types"

export function Spinner({ label }: SpinnerProps) {
  return <ProgressView>{label ? <Text>{label}</Text> : null}</ProgressView>
}
