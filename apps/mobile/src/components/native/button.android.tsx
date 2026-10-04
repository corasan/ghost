import { Button as ComposeButton, Text, TextButton } from "@expo/ui/jetpack-compose"
import { fillMaxWidth, paddingAll } from "@expo/ui/jetpack-compose/modifiers"
import type { ButtonProps } from "./types"

export function Button({ label, onPress, disabled, destructive, prominent }: ButtonProps) {
  const Component = prominent ? ComposeButton : TextButton
  return (
    <Component
      onClick={onPress}
      enabled={!disabled}
      modifiers={[fillMaxWidth(), paddingAll(8)]}
      colors={destructive ? { contentColor: "#b3261e" } : undefined}
    >
      <Text>{label}</Text>
    </Component>
  )
}
