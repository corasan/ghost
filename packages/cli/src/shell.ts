import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'

export interface Output {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

/** Runs a command to completion and captures what it printed. */
export const run = (command: ReadonlyArray<string>) =>
  Effect.promise(async (): Promise<Output> => {
    try {
      const child = Bun.spawn([...command], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { ok: code === 0, stdout, stderr }
    } catch (error) {
      return { ok: false, stdout: '', stderr: String(error) }
    }
  })

/** Hands the terminal to a command (an installer, a login) and reports whether it succeeded. */
export const runInteractive = (command: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    try {
      const child = Bun.spawn([...command], { stdio: ['inherit', 'inherit', 'inherit'] })
      return (await child.exited) === 0
    } catch {
      return false
    }
  })

/** `which`, plus the places installers put a binary before PATH picks it up. */
export const locate = (name: string, fallbacks: ReadonlyArray<string>) =>
  Bun.which(name) ?? fallbacks.find((path) => existsSync(path)) ?? null

export const findClaude = () =>
  locate('claude', [join(homedir(), '.local/bin/claude'), join(homedir(), '.claude/local/claude')])

// The Mac App Store build ships its CLI inside the app bundle and only links
// it onto PATH if the user opts in from the menu bar.
export const findTailscale = () =>
  locate('tailscale', ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'])

export const isMac = process.platform === 'darwin'
export const isRoot = process.getuid?.() === 0
