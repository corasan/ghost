import { StyleSheet, Text, View } from "react-native"
import type { SectionProps } from "./types"

export function Section({ title, footer, children }: SectionProps) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.title}>{title.toUpperCase()}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  title: { fontSize: 13, color: "#6b7280", paddingHorizontal: 4 },
  card: { borderRadius: 12, backgroundColor: "#f3f4f6", overflow: "hidden" },
  footer: { fontSize: 13, color: "#6b7280", paddingHorizontal: 4 },
})
