import { spawn } from "node:child_process"
import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { Health } from "@ghost/contract"
import { Data, Effect, Option, Schema } from "effect"
import type { Settings } from "./config-file.ts"
import type { GhostHome } from "./home.ts"
import { findClaude } from "./shell.ts"

export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string }> {}

export type ServerState =
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Running"; readonly pid: number }

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

const readPid = (path: string) => {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8"), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Reads the pid file and clears it when the process it names has died. */
export const serverState = (home: GhostHome): ServerState => {
  const pid = readPid(home.pid)
  if (pid !== null && alive(pid)) return { _tag: "Running", pid }
  rmSync(home.pid, { force: true })
  return { _tag: "Stopped" }
}

/**
 * Claims the pid file for this process. The file appears with its contents in
 * one step (a hard link of a finished temp file), so two starts racing each
 * other cannot both win and a reader never sees it half written.
 */
export const claimPidFile = (home: GhostHome) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      mkdirSync(home.root, { recursive: true })
      const draft = `${home.pid}.${process.pid}`
      writeFileSync(draft, String(process.pid))
      const link = () => {
        try {
          linkSync(draft, home.pid)
          return true
        } catch {
          return false
        }
      }
      const claimed = link() || (serverState(home)._tag === "Stopped" && link())
      rmSync(draft, { force: true })
      if (!claimed) {
        return yield* new CliFailure({
          message: "Ghost is already running. Stop it with `ghost stop`.",
        })
      }
    }),
    () =>
      Effect.sync(() => {
        if (readPid(home.pid) === process.pid) rmSync(home.pid, { force: true })
      }),
  )

export const portOf = (settings: Settings) => {
  const port = Number(process.env.GHOST_PORT ?? settings.get("GHOST_PORT") ?? 4848)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 4848
}

/** What the server process sees: the shell beats config.env, which beats the CLI's defaults. */
export const serverEnv = (home: GhostHome, settings: Settings) => {
  const env = new Map([["GHOST_DATA_DIR", home.data]])
  const claude = findClaude()
  if (claude !== null) env.set("GHOST_CLAUDE_PATH", claude)
  for (const [key, value] of settings) env.set(key, value)
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) env.set(key, value)
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
    mkdirSync(home.root, { recursive: true })
    rotateLog(home.log)
    const log = openSync(home.log, "a")
    const [command = process.execPath, ...args] = self
    const child = spawn(command, [...args, "start", "--foreground"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: Object.fromEntries(serverEnv(home, settings)),
    })
    child.unref()
    closeSync(log)
    const pid = child.pid
    if (pid === undefined) return yield* new CliFailure({ message: "Could not start Ghost." })
    const port = portOf(settings)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (!alive(pid)) {
        // Another start won the pid file while this one was launching.
        const winner = serverState(home)
        if (winner._tag === "Running") return winner.pid
        return yield* new CliFailure({
          message: `Ghost stopped while starting. The end of ${home.log}:\n\n${tail(home.log, 15)}`,
        })
      }
      if (Option.isSome(yield* health(port))) return pid
      yield* Effect.sleep("250 millis")
    }
    return yield* new CliFailure({
      message: `Ghost did not answer on port ${port} within 30 seconds. See \`ghost logs\`.`,
    })
  })

export const stopServer = (pid: number) =>
  Effect.gen(function* () {
    process.kill(pid, "SIGTERM")
    const deadline = Date.now() + 10_000
    while (alive(pid) && Date.now() < deadline) yield* Effect.sleep("100 millis")
    if (alive(pid)) process.kill(pid, "SIGKILL")
  })

export const tail = (path: string, lines: number) => {
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n")
  } catch {
    return ""
  }
}
