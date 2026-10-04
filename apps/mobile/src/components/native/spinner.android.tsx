import { LoadingIndicator, Row, Text } from "@expo/ui/jetpack-compose"
import { paddingAll } from "@expo/ui/jetpack-compose/modifiers"
import type { SpinnerProps } from "./types"

export function Spinner({ label }: SpinnerProps) {
  return (
    <Row
      verticalAlignment="center"
      horizontalArrangement={{ spacedBy: 12 }}
      modifiers={[paddingAll(16)]}
    >
      <LoadingIndicator />
      {label ? <Text>{label}</Text> : null}
    </Row>
  )
}
