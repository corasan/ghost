import { Host, LazyColumn } from "@expo/ui/jetpack-compose"
import type { ScreenProps } from "./types"

// LazyColumn is Compose's recycling list. Sections are its items, laid out
// with Material 3 spacing; pull to refresh is handled per screen by react
// query's refetch interval, so no PullToRefreshBox is needed yet.
export function Screen({ children }: ScreenProps) {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <LazyColumn
        verticalArrangement={{ spacedBy: 16 }}
        contentPadding={{ start: 16, end: 16, top: 16, bottom: 96 }}
      >
        {children}
      </LazyColumn>
    </Host>
  )
}
