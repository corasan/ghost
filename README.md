# Ghost

A Destiny 2 companion. The phone app talks over your tailnet to a small server
running on your own computer; the server lets Claude act on your account through
the Bungie API using the Claude subscription already logged in on that machine.

```
apps/mobile        Expo SDK 58 app, native UI (SwiftUI on iOS, Jetpack Compose on Android)
packages/server    Bun + Effect server: REST API, SQLite, MCP tools, Claude agent runner
packages/contract  The HTTP API and wire types both sides import
```

## Running it

```sh
bun install

# server (on the machine that has `claude` logged in)
cp packages/server/.env.example packages/server/.env   # fill in Bungie keys
bun run server                                          # http://127.0.0.1:4848, docs at /docs
bun run serve                                           # once: https://<machine>.<tailnet>.ts.net:4848 via Tailscale Serve

# app (needs a development build: @expo/ui has native code, so Expo Go won't do)
cd apps/mobile
bunx expo run:ios     # or: bunx expo run:android
```

In the app, open the Ghost tab, tap the `MCP · LOCAL` pill in the header, and
enter the server's tailnet address, for example `https://my-mac.tail1234.ts.net:4848`.
Then link your Bungie account from the same screen.

## The four tabs

The app follows the "Ghost - App Map" design: four tabs, dark only, Outfit
for text and JetBrains Mono for labels and numbers.

- **Ghost**: chat. Every message is a job on the server; the transcript is the
  job list. The row of kinds under the transcript picks how the agent is briefed
  (chat, build suggestion, weapon rolls, vault cleanup, postmaster to vault).
  Tapping the diamond opens History, the log of every request.
- **Guardian** (opens here): what each character has equipped, power, stats, and
  a banner when the postmaster is close to full that hands the ask to Ghost.
- **Vault**: the vault as a list with tier, type, and power. Cleanup mode asks
  Ghost to flag duplicates and low rolls and shows its answer above the list.
- **Recent**: items Ghost recorded (postmaster pulls), grouped by source and
  time, with keep / junk decided on the row and stored on the server.

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
4. The app polls `GET /jobs` while anything is queued or running, then shows the
   result in the Ghost transcript. Items the agent moved are written to
   `items_seen` and surfaced on the Recent tab.

Guardian and Vault do not go through the agent. `GET /guardian` and `GET /vault`
read the profile straight from Bungie and resolve item hashes against a local
copy of the Destiny manifest (`manifest_items`, downloaded once per manifest
version, about 30 MB on first use).

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

**Designed screens, native navigation.** The design is a custom dark UI (tier
colors, mono labels, chat bubbles) that neither SwiftUI's nor Compose's stock
components produce, so screens are plain React Native views styled from
`src/theme`. Navigation stays native: tabs use `NativeTabs`, so the bar is a
real `UITabBarController` on iOS and a Material bottom bar on Android, and the
settings sheet is a native modal.

## Status

The scaffold runs end to end (verified: create a job, the agent connects to the
MCP server, the job completes). What is not done yet:

- Bungie OAuth needs an https redirect URL registered on bungie.net; the
  `/auth/bungie/callback` route exists but has not been exercised against Bungie.
- Guardian and Vault have been checked against the Bungie API shapes but not
  against a live linked account yet.
- Recent shows the names the agent recorded; it does not resolve hashes through
  the manifest yet.
- Plans with per-row ticks (build swaps, postmaster routing) and Undo from
  History are in the design but not built: the server would need to journal
  each Bungie call a job makes and expose it. Dismantle is not possible at all,
  Bungie's API has no endpoint for it.
