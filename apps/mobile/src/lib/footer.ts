import { useCallback, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'

/** A footer floating over a scroll view, and the bottom padding the content needs to clear it. */
export function useFooterHeight() {
  const [height, setHeight] = useState(0)
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
    [],
  )
  return { height, onLayout }
}
