import { store } from './store'

const session = store<string | null>(null)
const revising = store<string | null>(null)

export const continueSession = (id: string) => {
  revising.set(null)
  session.set(id)
}

export const startFreshSession = () => {
  revising.set(null)
  session.set(null)
}

/**
 * Starts a fresh conversation whose first request revises the saved build.
 * The server carries the build to the conversation's later requests.
 */
export const startRevision = (buildId: string) => {
  session.set(null)
  revising.set(buildId)
}

/**
 * The conversation the chat shows. Null means a fresh one that has no
 * requests yet, which is where every launch starts.
 */
export const useSessionId = session.use

/** The saved build a fresh conversation will revise, until its first request is sent. */
export const usePendingRevision = revising.use
