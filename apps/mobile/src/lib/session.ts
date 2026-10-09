import { store } from './store'

const session = store<string | null>(null)

export const continueSession = (id: string) => session.set(id)
export const startFreshSession = () => session.set(null)

/**
 * The conversation the chat shows. Null means a fresh one that has no
 * requests yet, which is where every launch starts.
 */
export const useSessionId = session.use
