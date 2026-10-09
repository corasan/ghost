import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Everything the CLI keeps on this machine lives under one directory. */
export interface GhostHome {
  readonly root: string
  readonly config: string
  readonly data: string
  readonly pid: string
  readonly log: string
}

export const ghostHome = (): GhostHome => {
  const root = process.env.GHOST_HOME ?? join(homedir(), '.ghost')
  return {
    root,
    config: join(root, 'config.env'),
    data: join(root, 'data'),
    pid: join(root, 'ghost.pid'),
    log: join(root, 'ghost.log'),
  }
}

/**
 * Creates the home directory readable by this user only: config.env holds the
 * Bungie secret and the pairing token, and data/ holds the Bungie tokens.
 */
export const ensureHome = (home: GhostHome) => {
  mkdirSync(home.root, { recursive: true, mode: 0o700 })
  chmodSync(home.root, 0o700)
}
