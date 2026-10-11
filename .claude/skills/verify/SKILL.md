---
name: verify
description: Drive Ghost (the Destiny 2 companion) the way a player does and capture proof. Starts an isolated copy of packages/server from this checkout (its own port, data dir and pairing token, optionally a snapshot of the linked Bungie account), drives it over its REST API with curl and through the Expo app on the iOS simulator with argent, and keeps request, DB and screenshot evidence. Use to prove a server or app change works before calling it done.
---

# Verify Ghost

Ghost has two surfaces that ship together: the Expo app in `apps/mobile` (primary; what the player touches) and the Bun + Effect server in `packages/server` it talks to over the HTTP API declared in `packages/contract/src/api.ts`. A server change is proven over the API plus a read of SQLite; a UI change is proven in the app on the simulator, pointed at the same isolated server.

Everything goes through one helper. Run it from the repo root:

```bash
.claude/skills/verify/scripts/ghost-verify <command>
```

| Command | What it does |
| --- | --- |
| `up` | Start `bun src/main.ts` from this checkout on the first free port from 4901, data in `.verify/run/data`, fresh `GHOST_TOKEN`, Bungie unlinked |
| `up --linked` | Same, but with a copy of the player's database from `~/.ghost/data` and the Bungie and Jev keys from `~/.ghost/config.env` |
| `doctor` | Read-only health check of the instance this run started |
| `api METHOD PATH [JSON]` | Authenticated request; prints status then body, and saves both as numbered evidence |
| `sql "QUERY"` | Read-only query against the instance's SQLite, saved as evidence |
| `metro` | Start Metro for `apps/mobile` on the first free port from 8082 and print the dev-client deep link |
| `link` | Print the `ghost://connect` link that pairs the app with the verify server |
| `restore-link` | Print the `ghost://connect` link that pairs the app back with the player's own server |
| `env` | Print `BASE`, `PORT`, `EVIDENCE`, `MODE` |
| `down` | Stop what `up` and `metro` started, copy their logs into evidence, delete `.verify/run` |

## Launch

1. `bun install` once per checkout.
2. Pick a mode:
   - `up`: anything that does not need Bungie (health, auth guard, agent settings, an empty builds list, the 409 `BungieNotLinked` paths). Free and fully isolated.
   - `up --linked`: anything that reads the account (builds with readiness, vault, recent, guardian, briefing). It refuses when `~/.ghost` has no linked account.
3. Ready means the helper printed `ready: http://127.0.0.1:<port> (<mode>) pid <pid>` and `evidence: <dir>`. It waits up to 60s for `GET /health`, and prints the last 40 log lines if the server exits.

How the linked snapshot stays safe for the player:

- The database is copied with `sqlite3 .backup` (read-only on the source), so the player's running server (`ghost start`, data in `~/.ghost/data`) keeps working.
- In the copy, the Bungie refresh token is blanked and its expiry set to the access token's. Bungie refresh tokens are single use, so refreshing from a copy would sign the player's own server out; here the copy signs itself out instead. `up --linked` prints how long the access token lasts (at most an hour after the player's server last refreshed). After that the instance reports `bungieLinked: false`; `down` and `up --linked` again once the player's server has refreshed (any request to it does that).
- The access token is real. Any endpoint that writes to Bungie (see Evidence) acts on the player's actual characters.

Other things `up` sets on purpose: `GHOST_YOUTUBE_CHANNELS=,` (an empty value falls back to the default channel list, so a comma is what turns creator notes off and keeps the summarizer from spending Claude usage), empty `GHOST_TAILSCALE_USER` and `GHOST_TAILNET_HOST`, `--no-env-file` so `packages/server/.env` cannot override anything, and no `ANTHROPIC_API_KEY`.

### The app

Only when the change touches `apps/mobile`, or the proof needs the player's view:

1. `ghost-verify metro`, then open the printed `ghost://expo-development-client/?url=…` link with argent `open-url` on the booted iPhone simulator. The installed dev client (`com.henrypl.ghost`) loads this checkout's JS. If the app is not installed or its native code is stale, `cd apps/mobile && bunx expo run:ios` builds it.
2. Open the output of `ghost-verify link` with `open-url`. The app saves the verify server's URL and token in SecureStore and returns to chat.
3. `restart-app` with `com.henrypl.ghost`, then wait for `Ask Ghost`. The app persists its query cache and navigation for a week, so without a restart it can show screens and data from the previous server.
4. Read the `argent-device-interact` skill before driving it.

## Doctor

`ghost-verify doctor` exits non-zero unless the recorded pid is alive, owns the port, `/health` answers, and the token is accepted on `GET /agent`. It also prints the mode, `git rev-parse --short HEAD` with the count of changed files, and the evidence dir. Run it first, and again whenever a response looks wrong. A failing doctor means `down` then `up`, never driving whatever else answers on that port.

Never drive the player's own server (port 4848, started by `ghost start`, pid in `~/.ghost/ghost.pid`) or a Metro started by another project (8081 is often someone else's).

## Drive

### API

Routes, payloads and error codes are in `packages/contract/src/api.ts` and `schemas.ts`. Every route except `GET /health` and `GET /auth/bungie/callback` needs the bearer token, which `api` adds. Bungie-backed routes answer `409 {"_tag":"BungieNotLinked"}` when unlinked and `502` when Bungie fails.

```bash
V=.claude/skills/verify/scripts/ghost-verify
$V api GET /builds
$V api PATCH /builds/<id> '{"name":"New name","purpose":null,"items":["6917…"]}'
$V sql "select id, name, updated_at from saved_builds"
```

`api` prints the status code on the first line and the body on the second, so `| tail -1 | jq` reads the body.

### App

Use stable handles from the accessibility tree, not coordinates you guess:

- Drawer: `Open menu`, then rows labelled `CHAT, Ghost`, `GUARDIAN, Equipped`, `BUILDS, <n> saved`, `VAULT, <count> / <capacity>`, `RECENT, <n> new`, `HISTORY, <n> today`; character switch buttons `TITAN` / `HUNTER` / `WARLOCK`; `Settings` at the bottom.
- Chat input is the group `Ask Ghost` with the `Send` button.
- Sheets (build, edit build, item) render over the previous screen, and `describe` lists both. Pick the element whose frame sits inside the sheet.
- Wait for each drawer or sheet animation to finish (`await-ui-element` on the next screen's text, plus about a second) before the next tap; a tap during the animation lands on the screen underneath.
- Before typing, confirm the field has focus: a focused text field shows a `Clear text` button. Keys typed with nothing focused go to the dev client's shortcuts (`i` opens the element inspector; `restart-app` clears it).
- After typing, the keyboard covers the sheet's bottom buttons: press `enter`, wait for `Clear text` to go `hidden`, then tap.

Feature recipes are in [features/README.md](features/README.md).

## Evidence

Everything lands in `.verify/evidence/<run-id>/` (git-ignored), which `down` never deletes:

- `NN-<METHOD>-<path>.txt` from every `api` call: request, body, status, response.
- `NN-sql.txt` from every `sql` call.
- Screenshots: argent saves each one under a `Saved:` path; copy the ones that prove a step to `$EVIDENCE/NN-app-<what>.png`.
- `server.log` and `metro.log`, copied by `down`.

Proof standards:

- Go through the player's path: the app, or the same route the app calls. No direct SQLite writes and no handler calls from a script.
- Capture the action and the state after it: the request and the following read (`GET` plus `sql`), or the screen before and after the tap.
- Check side effects separately from the response: the row in `.verify/run/data/ghost.sqlite` and the request line in `server.log`. For a linked run, also confirm the player's database did not change: `sqlite3 -readonly ~/.ghost/data/ghost.sqlite "<same query>"`.
- Endpoints that write to Bungie with the real account: `POST /jobs/:id/apply`, `/jobs/:id/undo`, `/items/:id/action`, `/items/:id/perks/apply`, `/builds/:id/equip`, and every `/cleanup/*` command after `start`. Do not call them in a linked run unless the user agreed to that change in this conversation. Unlinked, they stop at 409, which proves only the guard.
- `POST /jobs` runs the Claude agent through the local `claude` login: it costs subscription usage and takes tens of seconds. The agent's tools only read, so a job is safe; applying its plan is not.

## Cleanup

1. If the app was paired, it now points at a server that is about to stop. `ghost-verify restore-link` prints a link holding the player's real pairing token, so do not open it yourself; give the player this command to run:

   ```bash
   xcrun simctl openurl booted "$(.claude/skills/verify/scripts/ghost-verify restore-link)"
   ```
2. `ghost-verify down`. It kills only the pids recorded in `.verify/run/state.env` (Metro with its child processes), copies the logs, and deletes `.verify/run`, including the database snapshot and its Bungie token.
3. Confirm: `lsof -nP -iTCP:<port> -sTCP:LISTEN` prints nothing, and `ls .verify/evidence/<run-id>` still lists the proof.

Run `down` after a failed attempt too; `up` refuses to start while `.verify/run/state.env` exists.
