import { createServer } from "node:net"
import { Console, Effect, Option, Redacted, Schema, Terminal } from "effect"
import { Prompt } from "effect/cli"
import { BUNGIE_APPS, callbackPath, verifyApiKey } from "./bungie.ts"
import { readSettings, type Settings, writeSettings } from "./config-file.ts"
import { portOf, serverState } from "./daemon.ts"
import type { GhostHome } from "./home.ts"
import { findClaude, isMac, isRoot, locate, run, runInteractive } from "./shell.ts"
import { tailnet, tailnetUrl } from "./tailscale.ts"
import { bold, cyan, dim } from "./ui.ts"

export type Outcome =
  | { readonly _tag: "Ready"; readonly detail: string }
  | { readonly _tag: "Missing"; readonly detail: string; readonly fix: string }

const ready = (detail: string): Outcome => ({ _tag: "Ready", detail })
const missing = (detail: string, fix: string): Outcome => ({ _tag: "Missing", detail, fix })

/** What a check can see: where Ghost lives and what config.env says right now. */
export interface Machine {
  readonly home: GhostHome
  readonly settings: Settings
}

export type RequirementId =
  | "claude"
  | "claude-login"
  | "tailscale"
  | "tailscale-up"
  | "tailscale-https"
  | "bungie"
  | "port"
  | "yt-dlp"
  | "typesafe"

/**
 * One thing the server needs. `doctor` runs every check; `setup` runs each
 * check and, when it fails, `resolve` walks the user through fixing it, then
 * checks again. A requirement whose `needs` failed is not checked at all.
 */
export interface Requirement {
  readonly id: RequirementId
  readonly name: string
  readonly optional: boolean
  readonly needs: RequirementId | null
  readonly check: (machine: Machine) => Effect.Effect<Outcome>
  readonly resolve: (
    machine: Machine,
  ) => Effect.Effect<void, Terminal.QuitError, Prompt.Environment>
}

const confirm = (message: string) => Prompt.Confirm({ message, initial: true })

const say = (...lines: ReadonlyArray<string>) =>
  Console.log(lines.map((line) => `  ${line}`).join("\n"))

const save = (machine: Machine, updates: ReadonlyArray<readonly [string, string]>) =>
  Effect.sync(() => writeSettings(machine.home.config, new Map(updates)))

const runIf = (question: string, command: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (yield* confirm(question)) {
      yield* Console.log(dim(`  $ ${command.join(" ")}`))
      yield* runInteractive(command)
    }
  })

const waitForUser = (message: string) => Effect.asVoid(Prompt.Confirm({ message, initial: true }))

const portFree = (port: number) =>
  Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        const server = createServer()
        server.once("error", () => resolve(false))
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)))
      }),
  )

const ClaudeAuth = Schema.Struct({
  loggedIn: Schema.Boolean,
  authMethod: Schema.optional(Schema.String),
})

const claude: Requirement = {
  id: "claude",
  name: "Claude Code",
  optional: false,
  needs: null,
  check: () =>
    Effect.gen(function* () {
      const binary = findClaude()
      if (binary === null) {
        return missing(
          "not installed",
          "Install it: curl -fsSL https://claude.ai/install.sh | bash",
        )
      }
      const version = yield* run([binary, "--version"])
      return version.ok
        ? ready(`${version.stdout.trim().split(" ")[0] ?? ""} at ${binary}`)
        : missing(
            `${binary} does not run`,
            "Reinstall it: curl -fsSL https://claude.ai/install.sh | bash",
          )
    }),
  resolve: () =>
    Effect.gen(function* () {
      yield* say("Ghost thinks with Claude Code, using the Claude subscription you sign in with.")
      yield* runIf("Install Claude Code now?", [
        "bash",
        "-c",
        "curl -fsSL https://claude.ai/install.sh | bash",
      ])
    }),
}

const claudeLogin: Requirement = {
  id: "claude-login",
  name: "Claude sign-in",
  optional: false,
  needs: "claude",
  check: () =>
    Effect.gen(function* () {
      const output = yield* run([findClaude() ?? "claude", "auth", "status", "--json"])
      const auth = Option.getOrNull(
        Schema.decodeUnknownOption(Schema.fromJsonString(ClaudeAuth))(output.stdout),
      )
      return auth?.loggedIn === true
        ? ready(`signed in${auth.authMethod === undefined ? "" : ` (${auth.authMethod})`}`)
        : missing("not signed in", "Run: claude auth login")
    }),
  resolve: () => runIf("Sign in to Claude now?", [findClaude() ?? "claude", "auth", "login"]),
}

const tailscale: Requirement = {
  id: "tailscale",
  name: "Tailscale",
  optional: false,
  needs: null,
  check: () =>
    Effect.map(tailnet, (net) =>
      net._tag === "Missing"
        ? missing("not installed", "Install it from https://tailscale.com/download")
        : ready(`installed at ${net.binary}`),
    ),
  resolve: () =>
    Effect.gen(function* () {
      yield* say("Your phone reaches Ghost over your tailnet, so this machine needs Tailscale.")
      if (isMac) {
        yield* say(
          `Install it from ${cyan("https://tailscale.com/download/mac")} or with ${bold("brew install --cask tailscale")},`,
          "open it once, and sign in.",
        )
        return yield* waitForUser("Installed?")
      }
      yield* runIf("Install Tailscale now? (it asks for your password)", [
        "bash",
        "-c",
        "curl -fsSL https://tailscale.com/install.sh | sh",
      ])
    }),
}

const tailscaleUp: Requirement = {
  id: "tailscale-up",
  name: "Tailscale connected",
  optional: false,
  needs: "tailscale",
  check: () =>
    Effect.map(tailnet, (net) =>
      net._tag === "Connected"
        ? ready(net.host)
        : missing(
            net._tag === "Stopped" ? `not connected (${net.state})` : "not installed",
            isMac ? "Open Tailscale and sign in" : "Run: sudo tailscale up --operator=$USER",
          ),
    ),
  resolve: () =>
    Effect.gen(function* () {
      const net = yield* tailnet
      if (net._tag === "Missing") return
      // On Linux, --operator lets this user run `tailscale serve` without sudo,
      // which `ghost start` does every time it exposes the server.
      const command =
        isMac || isRoot
          ? [net.binary, "up"]
          : ["sudo", net.binary, "up", `--operator=${process.env.USER ?? "root"}`]
      yield* runIf("Connect this machine to your tailnet now?", command)
    }),
}

const tailscaleHttps: Requirement = {
  id: "tailscale-https",
  name: "Tailscale HTTPS",
  optional: false,
  needs: "tailscale-up",
  check: () =>
    Effect.map(tailnet, (net) =>
      net._tag === "Connected" && net.https
        ? ready("certificates on")
        : missing(
            "HTTPS certificates are off for your tailnet",
            "Turn on MagicDNS and HTTPS at https://login.tailscale.com/admin/dns",
          ),
    ),
  resolve: () =>
    Effect.gen(function* () {
      yield* say(
        "Bungie only sends sign-ins back to an https address, and Tailscale issues the certificate.",
        `Open ${cyan("https://login.tailscale.com/admin/dns")}, turn on ${bold("MagicDNS")}, then ${bold("Enable HTTPS")}.`,
      )
      yield* waitForUser("Done?")
    }),
}

const bungieKeys = ["BUNGIE_API_KEY", "BUNGIE_CLIENT_ID", "BUNGIE_CLIENT_SECRET"] as const

const bungie: Requirement = {
  id: "bungie",
  name: "Bungie application",
  optional: false,
  needs: null,
  check: ({ settings }) =>
    Effect.gen(function* () {
      const absent = bungieKeys.filter((key) => (settings.get(key) ?? "") === "")
      if (absent.length > 0) {
        return missing(
          `${absent.join(", ")} not set`,
          "Run `ghost setup` to add your Bungie application",
        )
      }
      const rejected = yield* verifyApiKey(settings.get("BUNGIE_API_KEY") ?? "")
      return Option.match(rejected, {
        onNone: () => ready(`API key accepted, client ${settings.get("BUNGIE_CLIENT_ID") ?? ""}`),
        onSome: (reason) =>
          missing(`Bungie rejected the API key: ${reason}`, "Run `ghost setup` to replace it"),
      })
    }),
  resolve: (machine) =>
    Effect.gen(function* () {
      const net = yield* tailnet
      const port = portOf(machine.settings)
      const redirect =
        net._tag === "Connected"
          ? `${tailnetUrl(net.host, port)}${callbackPath}`
          : `https://<this machine's tailnet name>:${port}${callbackPath}`
      yield* say(
        "Ghost reads and moves your gear through a Bungie application that you own.",
        `1. Open ${cyan(BUNGIE_APPS)} and choose ${bold("Create New App")}.`,
        `2. OAuth Client Type: ${bold("Confidential")}`,
        `3. Redirect URL: ${bold(redirect)}`,
        `4. Scope: ${bold("Read your Destiny 2 information")} and ${bold("Move or equip Destiny gear")}`,
        "5. Agree to the terms and create it. The next screen shows the three values below.",
        "",
      )
      const apiKey = yield* Prompt.Password({
        message: "API Key",
        validate: (value) =>
          Effect.flatMap(verifyApiKey(value.trim()), (rejected) =>
            Option.match(rejected, {
              onNone: () => Effect.succeed(value),
              onSome: (reason) => Effect.fail(`Bungie rejected it: ${reason}`),
            }),
          ),
      })
      const clientId = yield* Prompt.String({
        message: "OAuth client_id",
        validate: (value) =>
          /^\d+$/.test(value.trim()) ? Effect.succeed(value) : Effect.fail("It is a number"),
      })
      const clientSecret = yield* Prompt.Password({
        message: "OAuth client_secret",
        validate: (value) =>
          value.trim() === "" ? Effect.fail("Paste the client secret") : Effect.succeed(value),
      })
      yield* save(machine, [
        ["BUNGIE_API_KEY", Redacted.value(apiKey).trim()],
        ["BUNGIE_CLIENT_ID", clientId.trim()],
        ["BUNGIE_CLIENT_SECRET", Redacted.value(clientSecret).trim()],
      ])
    }),
}

const port: Requirement = {
  id: "port",
  name: "Port",
  optional: false,
  needs: null,
  check: (machine) =>
    Effect.gen(function* () {
      const number = portOf(machine.settings)
      const state = serverState(machine.home)
      if (state._tag === "Running") return ready(`${number}, in use by Ghost (pid ${state.pid})`)
      return (yield* portFree(number))
        ? ready(`${number} is free`)
        : missing(`${number} is taken by another program`, "Pick another with `ghost setup`")
    }),
  resolve: (machine) =>
    Effect.gen(function* () {
      const chosen = yield* Prompt.Int({ message: "Port for Ghost", min: 1024, max: 65535 })
      yield* save(machine, [["GHOST_PORT", String(chosen)]])
    }),
}

const ytDlp: Requirement = {
  id: "yt-dlp",
  name: "yt-dlp",
  optional: true,
  needs: null,
  check: () =>
    Effect.sync(() => {
      const binary = locate("yt-dlp", ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"])
      return binary === null
        ? missing(
            "not found, so creator notes come from video descriptions only",
            isMac ? "brew install yt-dlp" : "pipx install yt-dlp",
          )
        : ready(binary)
    }),
  resolve: () =>
    Effect.gen(function* () {
      yield* say("yt-dlp reads YouTube captions, so creator notes quote what was said.")
      const brew = Bun.which("brew")
      const pipx = Bun.which("pipx")
      if (brew !== null)
        return yield* runIf("Install it with Homebrew?", [brew, "install", "yt-dlp"])
      if (pipx !== null) return yield* runIf("Install it with pipx?", [pipx, "install", "yt-dlp"])
      yield* say(
        `Install it from ${cyan("https://github.com/yt-dlp/yt-dlp#installation")} when you like.`,
      )
    }),
}

const typesafe: Requirement = {
  id: "typesafe",
  name: "TypeSafe key",
  optional: true,
  needs: null,
  check: ({ settings }) =>
    Effect.succeed(
      (settings.get("TYPESAFE_API_KEY") ?? "") === ""
        ? missing(
            "not set, so item searches come back unranked",
            "Add TYPESAFE_API_KEY with `ghost setup`",
          )
        : ready("set"),
    ),
  resolve: (machine) =>
    Effect.gen(function* () {
      yield* say(
        `Jev (${cyan("https://typesafe.ai")}) ranks item searches so Claude reads a short list per slot.`,
      )
      if (!(yield* Prompt.Confirm({ message: "Add a TypeSafe API key?", initial: false }))) return
      const key = yield* Prompt.Password({ message: "TypeSafe API key" })
      yield* save(machine, [["TYPESAFE_API_KEY", Redacted.value(key).trim()]])
    }),
}

export const requirements: ReadonlyArray<Requirement> = [
  claude,
  claudeLogin,
  tailscale,
  tailscaleUp,
  tailscaleHttps,
  bungie,
  port,
  ytDlp,
  typesafe,
]

export type Verdict = Outcome | { readonly _tag: "Blocked"; readonly by: string }

export const machineOf = (home: GhostHome): Machine => ({
  home,
  settings: readSettings(home.config),
})
