import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import pkg from '../package.json' with { type: 'json' }

/** Stamped into compiled binaries by scripts/build.ts. Absent when running from source. */
declare const GHOST_BUILD:
  | { readonly kind: 'release'; readonly version: string }
  | {
      readonly kind: 'clone'
      readonly version: string
      readonly source: string
      readonly commit: string
    }
  | undefined

/** How this copy of ghost got onto the machine, which decides how `ghost update` replaces it. */
export type Install =
  /** A binary from a GitHub release; the version is the release tag. */
  | { readonly _tag: 'Release'; readonly version: string; readonly binary: string }
  /** A binary built from a clone with `bun run install:cli`. */
  | {
      readonly _tag: 'Clone'
      readonly version: string
      readonly binary: string
      readonly source: string
      readonly commit: string
    }
  /** `bun run ghost` straight from a clone. */
  | { readonly _tag: 'Source'; readonly version: string; readonly source: string }

const installOf = (): Install => {
  if (typeof GHOST_BUILD === 'undefined')
    return { _tag: 'Source', version: pkg.version, source: resolve(import.meta.dir, '../../..') }
  // The path the binary was started by can be a symlink; replace the file it points at.
  const binary = realpathSync(process.execPath)
  return GHOST_BUILD.kind === 'release'
    ? { _tag: 'Release', version: GHOST_BUILD.version, binary }
    : { _tag: 'Clone', ...GHOST_BUILD, binary }
}

export const install = installOf()

/** What `ghost --version` prints: the release, or the package version and commit a clone was built at. */
export const displayVersion = (install: Install) =>
  install._tag === 'Clone' ? `${install.version}+${install.commit.slice(0, 7)}` : install.version

type Version = readonly [number, number, number]

/** Reads `1.2.3` or `v1.2.3`. Anything else, prereleases included, is not a version `update` installs. */
export const parseVersion = (text: string): Version | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

export const isNewer = (candidate: Version, current: Version) => {
  for (const i of [0, 1, 2] as const)
    if (candidate[i] !== current[i]) return candidate[i] > current[i]
  return false
}
