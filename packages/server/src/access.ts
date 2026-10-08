import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { AppConfig } from "./config.ts"
import { MCP_PATH } from "./mcp/path.ts"

export interface AccessValues {
  /** The pairing token the app sends as `Authorization: Bearer`. Empty refuses every guarded request. */
  readonly token: Redacted.Redacted<string>
  /** A token made fresh each start that only the agent this process runs knows. It guards /mcp. */
  readonly mcpToken: Redacted.Redacted<string>
  /** The tailnet login allowed through `tailscale serve`. Empty allows any login. */
  readonly tailscaleUser: string
  /** This machine's tailnet name, the Host `tailscale serve` passes through. Empty when unknown. */
  readonly tailnetHost: string
  /** Every Host a direct request may carry: the loopback names with the port. */
  readonly localHosts: ReadonlySet<string>
}

export class Access extends Context.Service<Access, AccessValues>()("Access") {}

export const AccessLive = Layer.effect(
  Access,
  Effect.gen(function* () {
    const { host, port } = yield* AppConfig
    const settings = yield* Config.all({
      token: Config.Redacted("GHOST_TOKEN").pipe(Config.withDefault(Redacted.make(""))),
      tailscaleUser: Config.String("GHOST_TAILSCALE_USER").pipe(Config.withDefault("")),
      tailnetHost: Config.String("GHOST_TAILNET_HOST").pipe(Config.withDefault("")),
    })
    if (Redacted.value(settings.token) === "") {
      yield* Effect.logWarning(
        "GHOST_TOKEN is not set, so the API refuses every request. `ghost start` sets one up.",
      )
    }
    return {
      ...settings,
      mcpToken: Redacted.make(randomBytes(32).toString("base64url")),
      localHosts: new Set(
        ["127.0.0.1", "localhost", "[::1]", host].map((name) => `${name}:${port}`.toLowerCase()),
      ),
    }
  }),
)

export interface Refusal {
  readonly status: 401 | 403
  readonly message: string
}

/** What the guard reads from a request; the header names are lower case. */
export interface Incoming {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string | undefined>>
}

// Bungie's browser redirect cannot carry a header, and the CLI polls health
// before it has anything to send.
const OPEN = new Set(["/health", "/auth/bungie/callback"])

// Hashing first makes both sides the same length, which timingSafeEqual needs.
const sameSecret = (given: string, expected: string) =>
  expected !== "" &&
  timingSafeEqual(
    createHash("sha256").update(given).digest(),
    createHash("sha256").update(expected).digest(),
  )

/**
 * Decides whether a request may reach a route, in three layers:
 *
 * - Host: a web page that rebinds its own name to 127.0.0.1 sends its own name
 *   as Host, so only the loopback names and the tailnet name are served.
 * - Tailscale identity: `tailscale serve` replaces any Tailscale-User-Login a
 *   client sent with the caller's real login, so a proxied request from
 *   another tailnet user is refused.
 * - Bearer token: the pairing token for the API, and a per-process token for
 *   /mcp so only the agent this server runs can call its tools.
 */
export const refusal = (access: AccessValues, request: Incoming): Refusal | null => {
  const host = (request.headers.host ?? "").toLowerCase()
  const login = request.headers["tailscale-user-login"]
  const tailnet = access.tailnetHost.toLowerCase()
  const knownHost =
    access.localHosts.has(host) ||
    (tailnet !== ""
      ? host === tailnet || host.startsWith(`${tailnet}:`)
      : login !== undefined && host !== "")
  if (!knownHost) return { status: 403, message: "Unknown host" }
  if (
    login !== undefined &&
    access.tailscaleUser !== "" &&
    login.toLowerCase() !== access.tailscaleUser.toLowerCase()
  ) {
    return { status: 403, message: "This Ghost belongs to another tailnet user" }
  }
  const path = request.url.split(/[?#]/)[0] ?? ""
  if (request.method === "GET" && OPEN.has(path)) return null
  const expected =
    path === MCP_PATH || path.startsWith(`${MCP_PATH}/`) ? access.mcpToken : access.token
  const given = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? "")?.[1] ?? ""
  return sameSecret(given, Redacted.value(expected))
    ? null
    : { status: 401, message: "Pair this app with `ghost pair`" }
}

/** Runs `refusal` in front of every route, the MCP endpoint and the docs included. */
export const AccessGuard = HttpRouter.middleware(
  Effect.gen(function* () {
    const access = yield* Access
    return (app) =>
      Effect.gen(function* () {
        const refused = refusal(access, yield* HttpServerRequest.HttpServerRequest)
        if (refused === null) return yield* app
        return HttpServerResponse.jsonUnsafe(
          { error: refused.message },
          {
            status: refused.status,
            headers: refused.status === 401 ? { "www-authenticate": "Bearer" } : {},
          },
        )
      })
  }),
  { global: true },
)
