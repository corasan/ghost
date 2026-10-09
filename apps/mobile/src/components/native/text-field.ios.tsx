import { TextField as SwiftTextField, useNativeState } from '@expo/ui/swift-ui'
import {
  autocorrectionDisabled,
  keyboardType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers'
import type { TextFieldProps } from './types'

export function TextField({ placeholder, initialValue, onChange, keyboard }: TextFieldProps) {
  const text = useNativeState(initialValue ?? '')
  return (
    <SwiftTextField
      placeholder={placeholder}
      text={text}
      onTextChange={onChange}
      modifiers={[
        keyboardType(keyboard === 'numeric' ? 'numeric' : keyboard === 'url' ? 'url' : 'default'),
        autocorrectionDisabled(true),
        textInputAutocapitalization('never'),
      ]}
    />
  )
}
