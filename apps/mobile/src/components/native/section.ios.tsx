import { Section as SwiftSection, Text } from "@expo/ui/swift-ui"
import type { SectionProps } from "./types"

export function Section({ title, footer, children }: SectionProps) {
  return (
    <SwiftSection title={title} footer={footer ? <Text>{footer}</Text> : undefined}>
      {children}
    </SwiftSection>
  )
}
