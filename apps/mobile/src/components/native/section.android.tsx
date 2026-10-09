import { Card, Column, Text } from '@expo/ui/jetpack-compose'
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers'
import type { SectionProps } from './types'

export function Section({ title, footer, children }: SectionProps) {
  return (
    <Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth()]}>
      {title ? (
        <Text style={{ typography: 'titleSmall' }} modifiers={[padding(4, 0, 4, 0)]}>
          {title}
        </Text>
      ) : null}
      <Card modifiers={[fillMaxWidth()]}>
        <Column modifiers={[fillMaxWidth()]}>{children}</Column>
      </Card>
      {footer ? (
        <Text style={{ typography: 'bodySmall' }} modifiers={[padding(4, 0, 4, 0)]}>
          {footer}
        </Text>
      ) : null}
    </Column>
  )
}
