import { Pressable, StyleSheet, Text } from "react-native"
import type { ButtonProps } from "./types"

export function Button({ label, onPress, disabled, destructive, prominent }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, prominent && styles.prominent, disabled && styles.disabled]}
    >
      <Text
        style={[styles.label, destructive && styles.destructive, prominent && styles.onProminent]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { padding: 14, alignItems: "center" },
  prominent: { backgroundColor: "#2563eb", borderRadius: 12, margin: 8 },
  disabled: { opacity: 0.4 },
  label: { fontSize: 16, color: "#2563eb" },
  destructive: { color: "#dc2626" },
  onProminent: { color: "white", fontWeight: "600" },
})
