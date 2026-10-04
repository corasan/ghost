import type { GuardianCharacter } from "@ghost/contract"
import * as SecureStore from "expo-secure-store"
import { useSyncExternalStore } from "react"

import { useGuardian } from "./api"

// Which character the player is "on" in Ghost. It is app state, not game
// state: switching in the menu changes what the header shows, which
// character the briefing compares against, and the target of "equip this".
const KEY = "ghost.characterId"

let current = SecureStore.getItem(KEY)
const listeners = new Set<() => void>()

export function getSelectedCharacterId() {
  return current
}

export function selectCharacter(id: string) {
  current = id
  SecureStore.setItem(KEY, id)
  for (const listener of listeners) listener()
}

function useSelectedId() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, getSelectedCharacterId)
}

/** The selected character, falling back to the highest power one. */
export function useCharacter(): {
  character: GuardianCharacter | undefined
  characters: readonly GuardianCharacter[]
} {
  const selected = useSelectedId()
  const guardian = useGuardian()
  const characters = guardian.data?.characters ?? []
  const character = characters.find((each) => each.characterId === selected) ?? characters[0]
  return { character, characters }
}
