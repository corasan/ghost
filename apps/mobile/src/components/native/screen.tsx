import { ScrollView, StyleSheet } from "react-native"
import type { ScreenProps } from "./types"

export function Screen({ children }: ScreenProps) {
  return <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
}

const styles = StyleSheet.create({ content: { padding: 16, gap: 24 } })
