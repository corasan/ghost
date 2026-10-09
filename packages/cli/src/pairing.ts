import { randomBytes } from "node:crypto"
import { writeSettings } from "./config-file.ts"
import { settingsOf } from "./daemon.ts"
import type { GhostHome } from "./home.ts"
import type { Tailnet } from "./tailscale.ts"

/**
 * The token the phone app sends with every request. It is made once and kept
 * in config.env, so pairing survives restarts; the QR code carries it.
 */
export const pairingToken = (home: GhostHome) => {
  const current = settingsOf(home).get("GHOST_TOKEN") ?? ""
  if (current !== "") return current
  const token = randomBytes(32).toString("base64url")
  writeSettings(home.config, new Map([["GHOST_TOKEN", token]]))
  return token
}

/**
 * Records the tailnet login that owns this machine the first time it is
 * known. The server then refuses requests tailscale serve brings in from any
 * other login, such as a shared node or another person on the tailnet.
 */
export const rememberOwner = (home: GhostHome, net: Tailnet) => {
  if (net._tag !== "Connected" || net.login === null) return
  if ((settingsOf(home).get("GHOST_TAILSCALE_USER") ?? "") !== "") return
  writeSettings(home.config, new Map([["GHOST_TAILSCALE_USER", net.login]]))
}
