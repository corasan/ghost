import { Form, Host } from "@expo/ui/swift-ui"
import { refreshable } from "@expo/ui/swift-ui/modifiers"
import type { ScreenProps } from "./types"

// A SwiftUI Form gives us grouped inset sections, pull to refresh and the
// system's own typography for free; everything on screen is native.
export function Screen({ children, onRefresh }: ScreenProps) {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form
        modifiers={
          onRefresh
            ? [
                refreshable(async () => {
                  await onRefresh()
                }),
              ]
            : []
        }
      >
        {children}
      </Form>
    </Host>
  )
}
