import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs"
import { Console, Effect, Layer, Option } from "effect"
import {
  CliFailure,
  claimPidFile,
  health,
  portOf,
  serverEnv,
  serverState,
  settingsOf,
  startBackground,
  stopServer,
  tail,
} from "./daemon.ts"
import type { GhostHome } from "./home.ts"
import { expose, pairingLink, tailnet, tailnetUrl, unexpose } from "./tailscale.ts"
import { bold, cyan, dim, green, qr, yellow } from "./ui.ts"

const needsSetup = (home: GhostHome) =>
  existsSync(home.config)
    ? Effect.void
    : Effect.fail(new CliFailure({ message: "Ghost isn't set up yet. Run `ghost setup` first." }))

/** Serves the port on the tailnet, and reports why not when that fails. */
const exposeNow = (port: number) =>
  Effect.gen(function* () {
    const net = yield* tailnet
    if (net._tag !== "Connected") return Option.none<string>()
    const served = yield* expose(net.binary, port)
    if (!served.ok) {
      const denied = /access denied|permission/i.test(served.stderr)
      yield* Console.error(
        yellow(
          denied
            ? "Tailscale would not let this user serve the port. Run: sudo tailscale set --operator=$USER"
            : `tailscale serve failed: ${served.stderr.trim()}`,
        ),
      )
      return Option.none<string>()
    }
    return Option.some(tailnetUrl(net.host, port))
  })

export const printPairing = (port: number) =>
  Effect.gen(function* () {
    const url = yield* exposeNow(port)
    if (Option.isNone(url)) {
      yield* Console.log(
        `Only this machine can reach Ghost, at http://127.0.0.1:${port}. ${dim("`ghost doctor` says what the tailnet needs.")}`,
      )
      return
    }
    const link = pairingLink(url.value)
    yield* Console.log(`\nOn your tailnet at ${bold(url.value)}\n`)
    yield* Console.log(yield* Effect.promise(() => qr(link)))
    yield* Console.log(`Scan it with your phone's camera, or open ${cyan(link)}\n`)
  })

/** Runs the server in this process until it is interrupted. */
export const runForeground = (home: GhostHome) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* needsSetup(home)
      const settings = settingsOf(home)
      for (const [key, value] of serverEnv(home, settings)) process.env[key] = value
      const port = portOf(settings)
      yield* claimPidFile(home, port)
      // The process that puts Ghost on the tailnet takes it off again on the way out.
      yield* Effect.addFinalizer(() =>
        Effect.flatMap(tailnet, (net) =>
          net._tag === "Connected" ? Effect.asVoid(unexpose(net.binary, port)) : Effect.void,
        ),
      )
      if (process.stdout.isTTY === true) yield* printPairing(port)
      else yield* exposeNow(port)
      const { ServerLive } = yield* Effect.promise(() => import("@ghost/server/server"))
      return yield* Layer.launch(ServerLive)
    }),
  )

export const start = (home: GhostHome) =>
  Effect.gen(function* () {
    yield* needsSetup(home)
    const settings = settingsOf(home)
    const port = portOf(settings)
    const state = serverState(home)
    if (state._tag === "Running") {
      yield* Console.log(`Ghost is already running (pid ${state.pid}).`)
      return yield* printPairing(port)
    }
    const pid = yield* startBackground(home, settings)
    yield* Console.log(`${green("Ghost is running")} in the background (pid ${pid}).`)
    yield* Console.log(dim(`Logs: ${home.log}. Stop it with \`ghost stop\`.`))
    yield* printPairing(port)
  })

export const stop = (home: GhostHome) =>
  Effect.gen(function* () {
    const state = serverState(home)
    if (state._tag === "Stopped") return yield* Console.log("Ghost isn't running.")
    yield* stopServer(home, state.pid)
    const net = yield* tailnet
    // The port the server recorded, not today's config: GHOST_PORT may have changed since it started.
    if (net._tag === "Connected")
      yield* unexpose(net.binary, state.port ?? portOf(settingsOf(home)))
    yield* Console.log(`Stopped Ghost (pid ${state.pid}).`)
  })

export const restart = (home: GhostHome) => Effect.andThen(stop(home), start(home))

export const status = (home: GhostHome) =>
  Effect.gen(function* () {
    const port = portOf(settingsOf(home))
    const state = serverState(home)
    const row = (label: string, value: string) => Console.log(`  ${dim(label.padEnd(8))} ${value}`)
    if (state._tag === "Stopped") {
      yield* Console.log(`Ghost is ${yellow("stopped")}. Start it with \`ghost start\`.`)
    } else {
      const answer = yield* health(port)
      yield* Console.log(`Ghost is ${green("running")} (pid ${state.pid}).`)
      yield* row(
        "Local",
        `http://127.0.0.1:${port} ${Option.isSome(answer) ? green("answering") : yellow("not answering")}`,
      )
      const net = yield* tailnet
      yield* row(
        "Tailnet",
        net._tag === "Connected" ? tailnetUrl(net.host, port) : yellow("not connected"),
      )
      yield* row(
        "Bungie",
        Option.match(answer, {
          onNone: () => dim("unknown"),
          onSome: (h) =>
            h.bungieLinked ? green("linked") : yellow("not linked, sign in from the app"),
        }),
      )
    }
    yield* row("Config", home.config)
    yield* row("Logs", home.log)
  })

const readFrom = (path: string, offset: number) => {
  const size = statSync(path).size
  const from = size < offset ? 0 : offset
  if (size === from) return { text: "", offset: from }
  const buffer = Buffer.alloc(size - from)
  const fd = openSync(path, "r")
  readSync(fd, buffer, 0, buffer.length, from)
  closeSync(fd)
  return { text: buffer.toString("utf8"), offset: size }
}

export const logs = (home: GhostHome, lines: number, follow: boolean) =>
  Effect.gen(function* () {
    if (!existsSync(home.log))
      return yield* Console.log("No logs yet. Ghost writes them once it starts in the background.")
    const recent = tail(home.log, lines)
    if (recent !== "") yield* Console.log(recent)
    if (!follow) return
    let offset = statSync(home.log).size
    while (true) {
      yield* Effect.sleep("500 millis")
      if (!existsSync(home.log)) continue
      // The log can be rotated between the check above and the read.
      const next = (() => {
        try {
          return readFrom(home.log, offset)
        } catch {
          return { text: "", offset }
        }
      })()
      offset = next.offset
      if (next.text !== "") process.stdout.write(next.text)
    }
  })

export const pair = (home: GhostHome) => printPairing(portOf(settingsOf(home)))
