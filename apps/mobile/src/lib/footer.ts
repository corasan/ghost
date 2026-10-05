import { useCallback, useState } from "react"
import type { LayoutChangeEvent } from "react-native"

/** A form sheet stretches its scroll view under a footer, so the content needs the footer's height as bottom padding. */
export function useFooterHeight() {
  const [height, setHeight] = useState(0)
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    [],
  )
  return { height, onLayout }
}
