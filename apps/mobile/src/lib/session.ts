import * as SecureStore from "expo-secure-store"
import { useSyncExternalStore } from "react"

import { useSessions } from "./api"

const KEY = "ghost.sessionId"
const FRESH = ""

let stored = SecureStore.getItem(KEY)
const listeners = new Set<() => void>()

const write = (value: string) => {
  stored = value
  SecureStore.setItem(KEY, value)
  for (const listener of listeners) listener()
}

export const continueSession = (id: string) => write(id)
export const startFreshSession = () => write(FRESH)

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The conversation the chat shows. Null means a fresh one that has no
 * requests yet. Until the player picks, it is the most recent conversation.
 */
export function useSessionId(): string | null {
  const chosen = useSyncExternalStore(subscribe, () => stored)
  const sessions = useSessions()
  if (chosen === null) return sessions.data?.[0]?.id ?? null
  return chosen === FRESH ? null : chosen
}
