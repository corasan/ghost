# Ghost

A Destiny 2 companion. The phone app talks over your tailnet to a small server
running on your own computer; the server lets Claude act on your account through
the Bungie API using the Claude subscription already logged in on that machine.

```
apps/mobile        Expo SDK 57 app, native UI (SwiftUI on iOS, Jetpack Compose on Android)
packages/server    Bun + Effect server: REST API, SQLite, MCP tools, Claude agent runner
packages/contract  The HTTP API and wire types both sides import
```

## Running it

```sh
bun install

# server (on the machine that has `claude` logged in)
cp packages/server/.env.example packages/server/.env   # fill in Bungie keys
bun run server                                          # http://0.0.0.0:4848, docs at /docs

# app (needs a development build: @expo/ui has native code, so Expo Go won't do)
cd apps/mobile
npx expo run:ios      # or: npx expo run:android
```

In the app, open Home, tap the server row, and enter the server's tailnet
address, for example `http://my-mac.tail1234.ts.net:4848`.

## How a request flows

1. The app creates a **job** (`POST /jobs`) with a kind such as `postmaster_to_vault`
   and a prompt. The server stores the row in SQLite and returns it immediately.
2. A single background fiber polls for queued jobs and runs each one through the
   **Claude Agent SDK**. That SDK runs Claude Code headless and authenticates with
   the `claude login` already on the machine, which is what makes the subscription
   pay for it rather than an API key.
3. The agent's only tools are the **ghost MCP server**, mounted on the same Bun
   HTTP server at `/mcp`. Each tool is a thin typed wrapper over one Bungie
   endpoint (`get_profile`, `transfer_item`, `pull_from_postmaster`, ...).
4. The app polls `GET /jobs/:id` until the status settles, then shows the result.
   Items the agent moved are written to `items_seen` and surfaced on Home as
   "Recently acquired".

## Design decisions worth knowing

**One process, one port.** The REST API the phone uses and the MCP endpoint the
agent uses are two route groups on the same `HttpRouter`. There is nothing to
deploy or keep in sync, and exposing a single port on the tailnet is enough.

**The contract package is the source of truth.** `packages/contract` declares the
API with Effect's `HttpApi`: every route, its params, payload, success and error
schemas. The server implements that value with `HttpApiBuilder`, and the app
derives a typed client from the same value with `HttpApiClient`. Renaming a
field is a compile error on both sides; there is no hand-written `fetch` code.

**Layers instead of globals.** Every piece of the server (config, SQLite, the
repositories, the Bungie client, the agent) is an Effect `Layer`. A layer
declares in its type what it needs, so wiring is checked at compile time in
`src/main.ts`, and a repository can be swapped for an in-memory one in a test
by providing a different layer.

**Jobs are rows, and the queue is a poll.** Effect could run the agent inline in
the request, but an agent run takes tens of seconds and a phone on a tailnet
will drop connections. Writing the job to SQLite first means the request returns
at once, a server restart cannot lose work, and the app only ever reads state.
One worker fiber also guarantees two agents never race to move the same items.

**Tools are small on purpose.** Each MCP tool does exactly one Bungie call. The
model composes the workflow (memberships, then profile, then transfers), and the
schema on each tool both documents it for the model and validates what the model
sends back. `vault_cleanup` only lists candidates; nothing is dismantled without
a list the player sees.

**Native primitives behind a tiny facade.** Screens in the app are written once
against seven components (`Screen`, `Section`, `Row`, `Button`, `TextField`,
`Spinner`, `Empty`). Each has a `.ios.tsx` built on `@expo/ui/swift-ui`, an
`.android.tsx` built on `@expo/ui/jetpack-compose`, and a plain React Native
fallback. Tabs use `NativeTabs`, so navigation is a real `UITabBarController`
and a Material bottom bar.

## Status

The scaffold runs end to end (verified: create a job, the agent connects to the
MCP server, the job completes). What is not done yet:

- Bungie OAuth needs an https redirect URL registered on bungie.net; the
  `/auth/bungie/callback` route exists but has not been exercised against Bungie.
- Item names are not resolved from the Destiny manifest yet, so "Recently
  acquired" shows item hashes until the agent records names.
- The design in the Claude Design project could not be imported from this
  session, so the screens follow the app map inferred from the project brief.
