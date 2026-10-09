import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SegmentedProps } from './types'

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <View style={styles.row}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[styles.segment, option.value === value && styles.selected]}
        >
          <Text style={styles.label}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 8, backgroundColor: '#15191f' },
  segment: { flex: 1, padding: 8, alignItems: 'center', borderRadius: 8 },
  selected: { backgroundColor: '#2E3135' },
  label: { fontSize: 13, color: '#e8ecf1' },
})
