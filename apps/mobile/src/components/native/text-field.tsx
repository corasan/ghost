import { StyleSheet, TextInput } from 'react-native'
import type { TextFieldProps } from './types'

export function TextField({
  placeholder,
  initialValue,
  onChange,
  keyboard,
  multiline,
}: TextFieldProps) {
  return (
    <TextInput
      style={styles.input}
      placeholder={placeholder}
      defaultValue={initialValue}
      onChangeText={onChange}
      keyboardType={keyboard === 'numeric' ? 'numeric' : keyboard === 'url' ? 'url' : 'default'}
      autoCapitalize="none"
      autoCorrect={false}
      multiline={multiline}
    />
  )
}

const styles = StyleSheet.create({ input: { padding: 14, fontSize: 16, minHeight: 48 } })
