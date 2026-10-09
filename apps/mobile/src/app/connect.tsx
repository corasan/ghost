import { useQueryClient } from '@tanstack/react-query'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'

import { setServerToken, setServerUrl } from '@/lib/server-url'

// Opened by the ghost://connect?url=…&token=… link in the QR code that
// `ghost start` and `ghost pair` show.
export default function ConnectScreen() {
  const { url, token } = useLocalSearchParams<{ url?: string; token?: string }>()
  const queryClient = useQueryClient()
  const valid = url !== undefined && /^https?:\/\/[^\s/]+/.test(url)

  useEffect(() => {
    if (!valid) return
    setServerUrl(url)
    if (token !== undefined && token !== '') setServerToken(token)
    // Anything fetched before pairing was refused, so ask again with the token.
    void queryClient.invalidateQueries()
  }, [valid, url, token, queryClient])

  return <Redirect href="/" />
}
