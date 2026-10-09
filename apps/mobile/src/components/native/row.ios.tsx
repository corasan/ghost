import { Button, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { buttonStyle, font, foregroundStyle } from '@expo/ui/swift-ui/modifiers'
import type { RowProps } from './types'

function Content({ title, subtitle, detail }: RowProps) {
  return (
    <HStack spacing={12}>
      <VStack alignment="leading" spacing={2}>
        <Text>{title}</Text>
        {subtitle ? (
          <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>
            {subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {detail ? <Text modifiers={[foregroundStyle('secondary')]}>{detail}</Text> : null}
    </HStack>
  )
}

export function Row(props: RowProps) {
  if (!props.onPress) return <Content {...props} />
  return (
    <Button onPress={props.onPress} modifiers={[buttonStyle('plain')]}>
      <Content {...props} />
    </Button>
  )
}
