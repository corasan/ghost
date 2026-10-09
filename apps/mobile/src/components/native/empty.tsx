import { StyleSheet, Text, View } from 'react-native'
import type { EmptyProps } from './types'

export function Empty({ title, description }: EmptyProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: 24, alignItems: 'center', gap: 4 },
  title: { fontSize: 16, fontWeight: '600' },
  description: { color: '#6b7280', textAlign: 'center' },
})
