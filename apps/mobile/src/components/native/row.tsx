import { Pressable, StyleSheet, Text, View } from "react-native"
import type { RowProps } from "./types"

export function Row({ title, subtitle, detail, onPress }: RowProps) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16 },
  subtitle: { fontSize: 13, color: "#6b7280" },
  detail: { fontSize: 15, color: "#6b7280" },
})
