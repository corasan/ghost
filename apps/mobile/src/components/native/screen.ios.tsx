import { Form, Host } from '@expo/ui/swift-ui'
import type { ScreenProps } from './types'

// A SwiftUI Form gives us grouped inset sections and the system's own
// typography for free; everything on screen is native.
export function Screen({ children }: ScreenProps) {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>{children}</Form>
    </Host>
  )
}
