import { Redirect, useLocalSearchParams } from "expo-router"
import { useEffect } from "react"

import { setServerUrl } from "@/lib/server-url"

export default function ConnectScreen() {
  const { url } = useLocalSearchParams<{ url?: string }>()
  const valid = url !== undefined && /^https?:\/\/[^\s/]+/.test(url)

  useEffect(() => {
    if (valid) setServerUrl(url)
  }, [valid, url])

  return <Redirect href="/" />
}
