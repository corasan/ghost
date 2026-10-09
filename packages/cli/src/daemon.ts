import { spawn } from "node:child_process"
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { Health } from "@ghost/contract"
import { Data, Effect, Option, Schema } from "effect"
import { effectiveSettings, type Settings } from "./config-file.ts"
import { ensureHome, type GhostHome } from "./home.ts"
import { findClaude } from "./shell.ts"

export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string }> {}

export type ServerState =
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Running"; readonly pid: number; readonly port: number | null }

// A pid alone is not an identity: after a crash or reboot the number in a
// leftover pid file can belong to anything. The pid file also records when
// that process started, and only a process with the same start time is Ghost.
// `ps` prints that time in the locale and time zone it runs with, so both are
// pinned: a stop run from another shell must read the same string as start.
const startedAt = (pid: number) => {
  const ps = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
  })
  const started = ps.stdout.toString().trim()
  return ps.success && started !== "" ? started : null
}

interface PidRecord {
  readonly pid: number
  readonly startedAt: string
  /** The port this server put on the tailnet, so stop takes that one off even if config changed. */
  readonly port: number | null
}

const readRecord = (path: string): PidRecord | null => {
  try {
    const [first = "", started = "", served = ""] = readFileSync(path, "utf8").split("\n")
    const pid = Number.parseInt(first, 10)
    const port = Number.parseInt(served, 10)
    return Number.isInteger(pid) && pid > 0 && started !== ""
      ? { pid, startedAt: started, port: Number.isInteger(port) ? port : null }
      : null
  } catch {
    return null
  }
}

const isLive = (record: PidRecord | null) =>
  record !== null && startedAt(record.pid) === record.startedAt

/** Reads the pid file. A file naming a process that is gone reads as Stopped. */
export const serverState = (home: GhostHome): ServerState => {
  const record = readRecord(home.pid)
  return record !== null && isLive(record)
    ? { _tag: "Running", pid: record.pid, port: record.port }
    : { _tag: "Stopped" }
}

const tryLink = (from: string, to: string) => {
  try {
    linkSync(from, to)
    return true
  } catch {
    return false
  }
}

/**
 * Claims the pid file for this process. The file appears with its contents in
 * one step (a hard link of a finished temp file), so two starts racing each
 * other cannot both win and a reader never sees it half written. A stale file
 * is first renamed aside, and only deleted once it proves to be stale, so a
 * start clearing it cannot delete a claim another start just made.
 */
export const claimPidFile = (home: GhostHome, port: number) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      ensureHome(home)
      const draft = `${home.pid}.${process.pid}`
      const aside = `${home.pid}.stale.${process.pid}`
      writeFileSync(draft, `${process.pid}\n${startedAt(process.pid) ?? ""}\n${port}`)
      let claimed = tryLink(draft, home.pid)
      if (!claimed && serverState(home)._tag === "Stopped") {
        try {
          renameSync(home.pid, aside)
        } catch {
          // another start moved it first
        }
        if (isLive(readRecord(aside))) tryLink(aside, home.pid)
        rmSync(aside, { force: true })
        claimed = tryLink(draft, home.pid)
      }
      rmSync(draft, { force: true })
      if (!claimed) {
        return yield* new CliFailure({
          message: "Ghost is already running. Stop it with `ghost stop`.",
        })
      }
    }),
    () =>
      Effect.sync(() => {
        if (readRecord(home.pid)?.pid === process.pid) rmSync(home.pid, { force: true })
      }),
  )

export const settingsOf = (home: GhostHome) => effectiveSettings(home.config)

export const portOf = (settings: Settings) => {
  const port = Number(settings.get("GHOST_PORT") ?? 4848)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 4848
}

/**
 * Claude Code prefers an API key over the subscription login, so a key
 * exported in the shell would quietly bill API credits for every run.
 */
export const BILLING_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const

/** What the server process sees: the shell beats config.env, which beats the CLI's defaults. */
export const serverEnv = (home: GhostHome, settings: Settings) => {
  const env = new Map([["GHOST_DATA_DIR", home.data]])
  const claude = findClaude()
  if (claude !== null) env.set("GHOST_CLAUDE_PATH", claude)
  for (const [key, value] of settings) env.set(key, value)
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) env.set(key, value)
  for (const key of BILLING_KEYS) env.delete(key)
  return env
}

export const health = (port: number) =>
  Effect.promise(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      return Schema.decodeUnknownOption(Health)(await response.json())
    } catch {
      return Option.none<Health>()
    }
  })

// A compiled binary is its own entry point; from source, Bun needs the script.
const self = Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main]

const LOG_LIMIT = 5 * 1024 * 1024

const rotateLog = (path: string) => {
  try {
    if (statSync(path).size > LOG_LIMIT) renameSync(path, `${path}.1`)
  } catch {
    // no log yet
  }
}

/** Starts `ghost start --foreground` detached, logging to the log file, and waits for /health. */
export const startBackground = (home: GhostHome, settings: Settings) =>
  Effect.gen(function* () {
    ensureHome(home)
    rotateLog(home.log)
    const log = openSync(home.log, "a")
    const [command = process.execPath, ...args] = self
    const child = spawn(command, [...args, "start", "--foreground"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: Object.fromEntries(serverEnv(home, settings)),
    })
    let exited = false
    child.once("exit", () => (exited = true))
    child.unref()
    closeSync(log)
    if (child.pid === undefined) return yield* new CliFailure({ message: "Could not start Ghost." })
    const port = portOf(settings)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      // Whichever start won the pid file is the server; this child may have lost that race.
      const state = serverState(home)
      if (state._tag === "Running" && Option.isSome(yield* health(port))) return state.pid
      if (exited && state._tag === "Stopped") {
        return yield* new CliFailure({
          message: `Ghost stopped while starting. The end of ${home.log}:\n\n${tail(home.log, 15)}`,
        })
      }
      yield* Effect.sleep("250 millis")
    }
    // Stop the child rather than leave a server that may come up after this reported failure.
    signal(child.pid, "SIGTERM")
    return yield* new CliFailure({
      message: `Ghost did not answer on port ${port} within 30 seconds, so it was stopped. See \`ghost logs\`.`,
    })
  })

const signal = (pid: number, name: NodeJS.Signals) => {
  try {
    process.kill(pid, name)
  } catch {
    // it exited on its own in the meantime
  }
}

/** Stops the server named by the pid file and waits until it is gone. */
export const stopServer = (home: GhostHome, pid: number) =>
  Effect.gen(function* () {
    const record = readRecord(home.pid)
    const running = () => isLive(record)
    signal(pid, "SIGTERM")
    const deadline = Date.now() + 10_000
    while (running() && Date.now() < deadline) yield* Effect.sleep("100 millis")
    if (running()) signal(pid, "SIGKILL")
    while (running()) yield* Effect.sleep("100 millis")
    if (readRecord(home.pid)?.pid === pid) rmSync(home.pid, { force: true })
  })

export const tail = (path: string, lines: number) => {
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n")
  } catch {
    return ""
  }
}
