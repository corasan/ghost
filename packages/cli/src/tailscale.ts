import { Effect, Option, Schema } from "effect"
import { findTailscale, run } from "./shell.ts"

const Status = Schema.Struct({
  BackendState: Schema.String,
  CertDomains: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  Self: Schema.optional(
    Schema.Struct({ DNSName: Schema.String, UserID: Schema.optional(Schema.Number) }),
  ),
  User: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Struct({ LoginName: Schema.String }))),
  ),
})

export type Tailnet =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Stopped"; readonly binary: string; readonly state: string }
  | {
      readonly _tag: "Connected"
      readonly binary: string
      readonly host: string
      readonly https: boolean
      /** The login that owns this machine, which is the only one the server lets in through serve. */
      readonly login: string | null
    }

export const tailnet = Effect.gen(function* () {
  const binary = findTailscale()
  if (binary === null) return { _tag: "Missing" } satisfies Tailnet
  const output = yield* run([binary, "status", "--json"])
  const status = Option.getOrNull(
    Schema.decodeUnknownOption(Schema.fromJsonString(Status))(output.stdout),
  )
  const host = status?.Self?.DNSName.replace(/\.$/, "") ?? ""
  if (status === null || status.BackendState !== "Running" || host === "") {
    return { _tag: "Stopped", binary, state: status?.BackendState ?? "unknown" } satisfies Tailnet
  }
  const https = (status.CertDomains ?? []).length > 0
  const owner = status.Self?.UserID
  const login = owner === undefined ? null : (status.User?.[String(owner)]?.LoginName ?? null)
  return { _tag: "Connected", binary, host, https, login } satisfies Tailnet
})

export const tailnetUrl = (host: string, port: number) => `https://${host}:${port}`

/** The link the phone app opens to connect: the server's address and the token it must send. */
export const pairingLink = (url: string, token: string) =>
  `ghost://connect?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`

/** Serves the loopback-only server on the tailnet over https. Safe to repeat. */
export const expose = (binary: string, port: number) =>
  run([binary, "serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`])

export const unexpose = (binary: string, port: number) =>
  run([binary, "serve", `--https=${port}`, "off"])

const ServeStatus = Schema.Struct({
  Web: Schema.optional(
    Schema.NullOr(
      Schema.Record(
        Schema.String,
        Schema.Struct({
          Handlers: Schema.optional(
            Schema.NullOr(
              Schema.Record(
                Schema.String,
                Schema.Struct({ Proxy: Schema.optional(Schema.String) }),
              ),
            ),
          ),
        }),
      ),
    ),
  ),
})

/** Ports `tailscale serve` publishes in the shape `expose` sets up: https on a port to that port on loopback. */
export const servedPorts = (binary: string) =>
  Effect.gen(function* () {
    const output = yield* run([binary, "serve", "status", "--json"])
    const status = Option.getOrNull(
      Schema.decodeUnknownOption(Schema.fromJsonString(ServeStatus))(output.stdout),
    )
    const ports = new Set<number>()
    for (const [hostPort, web] of Object.entries(status?.Web ?? {})) {
      const port = Number(hostPort.slice(hostPort.lastIndexOf(":") + 1))
      const handlers = Object.values(web.Handlers ?? {})
      if (handlers.some((handler) => handler.Proxy === `http://127.0.0.1:${port}`)) ports.add(port)
    }
    return [...ports]
  })
