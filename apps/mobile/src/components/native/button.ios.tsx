import { Button as SwiftButton } from '@expo/ui/swift-ui'
import { buttonStyle, controlSize, disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers'
import type { ButtonProps } from './types'

export function Button({ label, onPress, disabled, destructive, prominent }: ButtonProps) {
  return (
    <SwiftButton
      label={label}
      onPress={onPress}
      role={destructive ? 'destructive' : 'default'}
      modifiers={[
        buttonStyle(prominent ? 'borderedProminent' : 'automatic'),
        controlSize(prominent ? 'large' : 'regular'),
        disabledModifier(disabled ?? false),
      ]}
    />
  )
}
