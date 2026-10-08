import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type Settings = ReadonlyMap<string, string>

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

// A quoted value may be followed by a comment, as in KEY="a b" # note.
const DOUBLE = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/
const SINGLE = /^'([^']*)'(?:\s+#.*)?$/

const unquote = (raw: string) => {
  const double = DOUBLE.exec(raw)?.[1]
  if (double !== undefined) {
    try {
      return String(JSON.parse(double))
    } catch {
      return double.slice(1, -1)
    }
  }
  return SINGLE.exec(raw)?.[1] ?? raw.replace(/\s+#.*$/, "")
}

const quote = (value: string) => (/[\s#"']/.test(value) ? JSON.stringify(value) : value)

export const parseSettings = (text: string): Settings => {
  const settings = new Map<string, string>()
  for (const line of text.split("\n")) {
    const match = LINE.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined)
      settings.set(match[1], unquote(match[2]))
  }
  return settings
}

/**
 * Rewrites the keys in `updates` where they already appear and appends the
 * rest, so comments and settings the CLI does not know about survive a setup run.
 */
export const updateSettings = (text: string, updates: Settings): string => {
  const pending = new Map(updates)
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n")
  const rewritten = lines.map((line) => {
    const key = LINE.exec(line)?.[1]
    const value = key === undefined ? undefined : pending.get(key)
    if (key === undefined || value === undefined) return line
    pending.delete(key)
    return `${key}=${quote(value)}`
  })
  for (const [key, value] of pending) rewritten.push(`${key}=${quote(value)}`)
  return `${rewritten.join("\n")}\n`
}

export const readSettings = (path: string): Settings =>
  existsSync(path) ? parseSettings(readFileSync(path, "utf8")) : new Map()

export const writeSettings = (path: string, updates: Settings) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const current = existsSync(path) ? readFileSync(path, "utf8") : ""
  writeFileSync(path, updateSettings(current, updates), { mode: 0o600 })
  chmodSync(path, 0o600)
}

const OWN_KEYS = /^(GHOST_|BUNGIE_|TYPESAFE_)/

/** config.env, with any of Ghost's settings exported in the shell taking precedence. */
export const effectiveSettings = (path: string): Settings => {
  const settings = new Map(readSettings(path))
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && OWN_KEYS.test(key)) settings.set(key, value)
  }
  return settings
}
