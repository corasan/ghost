import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Console, Effect, Schema } from 'effect'
import { CliFailure, serverState } from './daemon.ts'
import type { GhostHome } from './home.ts'
import { type Install, displayVersion, isNewer, parseVersion } from './install.ts'
import { run, runInteractive } from './shell.ts'
import { bold, dim, green } from './ui.ts'

const REPO = 'corasan/ghost'

const Release = Schema.Struct({
  tag_name: Schema.String,
  html_url: Schema.String,
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      browser_download_url: Schema.String,
      // GitHub records each asset's sha256 as "sha256:<hex>".
      digest: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

const fail = (message: string) => new CliFailure({ message })

const latestRelease = Effect.tryPromise({
  try: async () => {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
    return Schema.decodeUnknownSync(Release)(await response.json())
  },
  catch: (error) => fail(`Could not look up the latest Ghost release: ${String(error)}`),
})

/** The release asset install.sh picks for this machine. */
const assetName = () => {
  const os = process.platform === 'darwin' || process.platform === 'linux' ? process.platform : null
  const arch = process.arch === 'arm64' || process.arch === 'x64' ? process.arch : null
  return os === null || arch === null ? null : `ghost-${os}-${arch}`
}

/** Downloads the asset and checks it against the sha256 GitHub recorded for it. */
const download = (url: string, digest: string | null | undefined) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const sha = `sha256:${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}`
      if (digest != null && digest !== sha)
        throw new Error(`its checksum is ${sha}, but GitHub lists ${digest}`)
      return bytes
    },
    catch: (error) => fail(`Could not download ${url}: ${String(error)}`),
  })

/**
 * Puts the new binary next to the old one, makes sure it runs and reports the
 * expected version, then renames it over the old one. A rename is atomic, and
 * the running process keeps the old file open, so nothing is ever half written.
 */
const replaceBinary = (binary: string, bytes: Uint8Array, version: string) =>
  Effect.gen(function* () {
    const staged = `${binary}.update`
    yield* Effect.try({
      try: () => {
        writeFileSync(staged, bytes)
        chmodSync(staged, 0o755)
      },
      catch: () =>
        fail(
          `Could not write to ${dirname(binary)}. Run \`sudo ghost update\`, or reinstall with install.sh.`,
        ),
    })
    const probe = yield* run([staged, '--version'])
    if (!probe.ok || !probe.stdout.includes(version)) {
      rmSync(staged, { force: true })
      const why = probe.ok
        ? `reports ${probe.stdout.trim()} instead of ${version}`
        : `did not start: ${probe.stderr.trim()}`
      return yield* fail(`The downloaded binary ${why}. ${binary} was left as it was.`)
    }
    renameSync(staged, binary)
  })

/** Restarts the server if it was running, with whatever binary is now installed. */
const restartServer = (home: GhostHome, command: ReadonlyArray<string>, wasRunning: boolean) =>
  Effect.gen(function* () {
    if (!wasRunning) return
    yield* Console.log('Restarting the server on the new version.')
    if (!(yield* runInteractive([...command, 'restart'])))
      return yield* fail(
        `The update is installed, but the server did not restart. See ${home.log}.`,
      )
  })

const updateRelease = (
  home: GhostHome,
  install: Extract<Install, { _tag: 'Release' }>,
  check: boolean,
) =>
  Effect.gen(function* () {
    const release = yield* latestRelease
    const latest = parseVersion(release.tag_name)
    const current = parseVersion(install.version)
    if (latest === null)
      return yield* fail(`The latest release has an unexpected tag, ${release.tag_name}.`)
    if (current !== null && !isNewer(latest, current))
      return yield* Console.log(`${green('Ghost is up to date')} (${install.version}).`)
    const version = latest.join('.')
    yield* Console.log(`Ghost ${bold(version)} is out. You have ${install.version}.`)
    if (check)
      return yield* Console.log(dim(`Install it with \`ghost update\`. Notes: ${release.html_url}`))
    const name = assetName()
    const asset = release.assets.find((a) => a.name === name)
    if (asset === undefined)
      return yield* fail(
        `The ${release.tag_name} release has no build for this machine (${name ?? process.platform}).`,
      )
    const wasRunning = serverState(home)._tag === 'Running'
    yield* Console.log(dim(`Downloading ${asset.browser_download_url}`))
    const bytes = yield* download(asset.browser_download_url, asset.digest)
    yield* replaceBinary(install.binary, bytes, version)
    yield* Console.log(`${green('Updated')} ${install.binary} to ${version}.`)
    yield* restartServer(home, [install.binary], wasRunning)
  })

const git = (source: string, ...args: ReadonlyArray<string>) => run(['git', '-C', source, ...args])

/** A clone (or a binary built from one) updates by pulling, and a built binary by rebuilding too. */
const updateCheckout = (
  home: GhostHome,
  install: Extract<Install, { _tag: 'Clone' | 'Source' }>,
  check: boolean,
) =>
  Effect.gen(function* () {
    const { source } = install
    if (!(yield* git(source, 'rev-parse', '--is-inside-work-tree')).ok)
      return yield* fail(`This ghost was built from ${source}, which is no longer a git checkout.`)
    yield* Console.log(dim(`Checking ${source} against its upstream branch.`))
    const fetched = yield* git(source, 'fetch', '--quiet')
    if (!fetched.ok) return yield* fail(`git fetch failed in ${source}:\n${fetched.stderr.trim()}`)
    const upstream = yield* git(source, 'rev-parse', '@{upstream}')
    if (!upstream.ok)
      return yield* fail(`The branch checked out in ${source} has no upstream to update from.`)
    const behind = Number(
      (yield* git(source, 'rev-list', '--count', 'HEAD..@{upstream}')).stdout.trim(),
    )
    // A binary is current when it was built at the upstream commit; a source run only needs the pull.
    const built = install._tag === 'Clone' ? install.commit : null
    const stale = behind > 0 || (built !== null && built !== upstream.stdout.trim())
    if (!stale)
      return yield* Console.log(`${green('Ghost is up to date')} (${displayVersion(install)}).`)
    yield* Console.log(
      behind > 0
        ? `${source} is ${bold(String(behind))} commit${behind === 1 ? '' : 's'} behind its upstream.`
        : `${source} is current, but ${install._tag === 'Clone' ? install.binary : 'ghost'} was built from an older commit.`,
    )
    if (check) return yield* Console.log(dim('Install it with `ghost update`.'))
    const wasRunning = serverState(home)._tag === 'Running'
    if (behind > 0) {
      // --ff-only refuses rather than merge, so local commits or edits that conflict stay untouched.
      const pulled = yield* git(source, 'pull', '--ff-only', '--quiet')
      if (!pulled.ok)
        return yield* fail(
          `git pull --ff-only failed in ${source}, so nothing changed:\n${pulled.stderr.trim()}`,
        )
    }
    const bun = Bun.which('bun')
    if (bun === null)
      return yield* fail('Pulled the latest code, but bun is not on PATH to build it.')
    if (!(yield* runInteractive([bun, 'install', '--cwd', source])))
      return yield* fail(`bun install failed in ${source}.`)
    if (install._tag === 'Source') {
      yield* Console.log(green('Pulled the latest code.'))
      return yield* restartServer(home, [bun, 'run', '--cwd', source, 'ghost'], wasRunning)
    }
    const rebuilt = yield* runInteractive([
      bun,
      'run',
      '--cwd',
      `${source}/packages/cli`,
      'build',
      '--install',
      '--install-dir',
      dirname(install.binary),
    ])
    if (!rebuilt)
      return yield* fail(`The build failed in ${source}, so ${install.binary} was left as it was.`)
    yield* restartServer(home, [install.binary], wasRunning)
  })

export const update = (home: GhostHome, install: Install, check: boolean) =>
  install._tag === 'Release'
    ? updateRelease(home, install, check)
    : updateCheckout(home, install, check)
