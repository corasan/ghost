import type { QueryObserverResult } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

/**
 * Pull-to-refresh state that is true only while a pull the player started
 * is in flight. Background polling must not drive the spinner, or the list
 * jumps every time a poll starts and ends.
 */
export function usePullRefresh(...refetch: readonly (() => Promise<QueryObserverResult>)[]) {
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void Promise.allSettled(refetch.map((each) => each())).then(() => setRefreshing(false))
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, refetch)
  return { refreshing, onRefresh }
}
