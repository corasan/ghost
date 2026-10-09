import { OutlinedTextField, Text, useNativeState } from '@expo/ui/jetpack-compose'
import { fillMaxWidth, paddingAll } from '@expo/ui/jetpack-compose/modifiers'
import type { TextFieldProps } from './types'

export function TextField({
  placeholder,
  initialValue,
  onChange,
  keyboard,
  multiline,
}: TextFieldProps) {
  const value = useNativeState(initialValue ?? '')
  return (
    <OutlinedTextField
      value={value}
      onValueChange={onChange}
      singleLine={!multiline}
      keyboardOptions={{
        keyboardType: keyboard === 'numeric' ? 'number' : keyboard === 'url' ? 'uri' : 'text',
        autoCorrectEnabled: false,
      }}
      modifiers={[fillMaxWidth(), paddingAll(8)]}
    >
      <OutlinedTextField.Placeholder>
        <Text>{placeholder}</Text>
      </OutlinedTextField.Placeholder>
    </OutlinedTextField>
  )
}
