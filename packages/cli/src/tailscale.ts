import { Effect, Option, Schema } from "effect"
import { findTailscale, run } from "./shell.ts"

const Status = Schema.Struct({
  BackendState: Schema.String,
  CertDomains: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  Self: Schema.optional(Schema.Struct({ DNSName: Schema.String })),
})

export type Tailnet =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Stopped"; readonly binary: string; readonly state: string }
  | {
      readonly _tag: "Connected"
      readonly binary: string
      readonly host: string
      readonly https: boolean
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
  return { _tag: "Connected", binary, host, https } satisfies Tailnet
})

export const tailnetUrl = (host: string, port: number) => `https://${host}:${port}`

export const pairingLink = (url: string) => `ghost://connect?url=${encodeURIComponent(url)}`

/** Serves the loopback-only server on the tailnet over https. Safe to repeat. */
export const expose = (binary: string, port: number) =>
  run([binary, "serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`])

export const unexpose = (binary: string, port: number) =>
  run([binary, "serve", `--https=${port}`, "off"])
