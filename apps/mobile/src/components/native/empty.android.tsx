import { Column, Text } from "@expo/ui/jetpack-compose"
import { fillMaxWidth, paddingAll } from "@expo/ui/jetpack-compose/modifiers"
import type { EmptyProps } from "./types"

export function Empty({ title, description }: EmptyProps) {
  return (
    <Column
      horizontalAlignment="center"
      verticalArrangement={{ spacedBy: 4 }}
      modifiers={[fillMaxWidth(), paddingAll(24)]}
    >
      <Text style={{ typography: "titleMedium" }}>{title}</Text>
      {description ? <Text style={{ typography: "bodyMedium" }}>{description}</Text> : null}
    </Column>
  )
}
