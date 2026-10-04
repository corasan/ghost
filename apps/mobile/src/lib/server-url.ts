import * as SecureStore from "expo-secure-store"
import { useSyncExternalStore } from "react"

// The server URL is the one piece of config the app owns. It is the
// tailnet address of the machine running packages/server, for example
// http://my-mac.tail1234.ts.net:4848, so it never changes while the app
// is open and a tiny external store is enough.
const KEY = "ghost.serverUrl"
const DEFAULT_URL = "http://localhost:4848"

let current = SecureStore.getItem(KEY) ?? DEFAULT_URL
const listeners = new Set<() => void>()

export function getServerUrl() {
  return current
}

export function setServerUrl(url: string) {
  current = url.trim().replace(/\/+$/, "") || DEFAULT_URL
  SecureStore.setItem(KEY, current)
  for (const listener of listeners) listener()
}

export function useServerUrl() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, getServerUrl)
}
