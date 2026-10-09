import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { SpinnerProps } from './types'

export function Spinner({ label }: SpinnerProps) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  label: { color: '#6b7280' },
})
