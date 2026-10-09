import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

// The server URL and its pairing token are the only config the app owns.
// The URL is the tailnet address of the machine running packages/server, for
// example https://my-mac.tail1234.ts.net:4848, and the token is what that
// server expects in every request's Authorization header. Both come from the
// QR code `ghost start` shows, so they never change while the app is open
// and a tiny external store is enough.
const URL_KEY = 'ghost.serverUrl'
const TOKEN_KEY = 'ghost.serverToken'
const DEFAULT_URL = 'http://localhost:4848'

let current = SecureStore.getItem(URL_KEY) ?? DEFAULT_URL
let token = SecureStore.getItem(TOKEN_KEY) ?? ''
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

export function getServerUrl() {
  return current
}

export function getServerToken() {
  return token
}

export function setServerUrl(url: string) {
  current = url.trim().replace(/\/+$/, '') || DEFAULT_URL
  SecureStore.setItem(URL_KEY, current)
  notify()
}

export function setServerToken(value: string) {
  token = value.trim()
  SecureStore.setItem(TOKEN_KEY, token)
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useServerUrl() {
  return useSyncExternalStore(subscribe, getServerUrl)
}

export function useServerToken() {
  return useSyncExternalStore(subscribe, getServerToken)
}
