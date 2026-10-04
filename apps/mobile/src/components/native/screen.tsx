import { useState } from "react"
import { RefreshControl, ScrollView, StyleSheet } from "react-native"
import type { ScreenProps } from "./types"

export function Screen({ children, onRefresh }: ScreenProps) {
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined
      }
    >
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({ content: { padding: 16, gap: 24 } })
