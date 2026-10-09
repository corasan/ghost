# Ghost

A Destiny 2 companion. The phone app talks over your tailnet to a small server
running on your own computer; the server lets Claude act on your account through
the Bungie API using the Claude subscription already logged in on that machine.

## Running it

The server runs on a computer that has Claude Code signed in. The `ghost` CLI
sets that machine up, then starts and stops the server.

```
apps/mobile        Expo SDK 58 app, native UI (SwiftUI on iOS, Jetpack Compose on Android)
packages/cli       the `ghost` command: setup, doctor, start, stop, status, logs, pair
packages/server    Bun + Effect server: REST API, SQLite, MCP tools, Claude agent runner
packages/contract  The HTTP API and wire types both sides import
```

### Install the CLI

Download the latest release (macOS and Linux, arm64 and x64):

```sh
curl -fsSL https://raw.githubusercontent.com/corasan/ghost/main/install.sh | sh
```

Or build it from a clone, which needs [Bun](https://bun.sh):

```sh
bun install
bun run install:cli   # builds packages/cli/dist/ghost and copies it to ~/.local/bin
```

Either way the result is one self-contained binary with the server inside it.
Pushing a `v*` tag builds the release binaries (`.github/workflows/release.yml`),
and the tag is the version they report. `ghost update` keeps either kind current:
a release binary downloads the newest release, a clone build pulls and rebuilds,
and a running server is restarted on the new version.

### Set up and run

```sh
ghost setup     # guided: Claude Code, Tailscale, your Bungie app, optional extras
ghost start     # runs the server in the background and prints the pairing QR
```

`ghost setup` checks each thing the server needs and walks you through
whatever is missing: it can install Claude Code and Tailscale, sign you in,
tells you exactly what to enter when you register the Bungie application
(including the redirect URL for this machine), and checks the API key with
Bungie before saving it. Run it again any time; it only asks about what is
still missing. `ghost doctor` runs the same checks without changing anything
and exits non-zero when something required is missing.

| Command                        | What it does                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `ghost start`                  | Start in the background, wait until it answers, print the QR code                       |
| `ghost start -f`               | Run in this terminal instead, logging to stdout                                         |
| `ghost stop` / `ghost restart` | Stop the background server (and take it off the tailnet)                                |
| `ghost status`                 | Running or not, local and tailnet addresses, whether Bungie is linked                   |
| `ghost logs [-f] [-n 100]`     | Print or follow the background server's log                                             |
| `ghost pair`                   | Print the QR code again                                                                 |
| `ghost token`                  | Print the pairing token, to enter it in the app by hand                                 |
| `ghost update [--check]`       | Install the newest version and restart the server (`--check` only says if there is one) |

Everything lives in `~/.ghost` (`GHOST_HOME` moves it, and only your user can
read it): `config.env` with your keys and the pairing token, `data/` with the
SQLite database, `ghost.log` and `ghost.pid`. Settings in the shell environment
win over `config.env`. The server finds Claude Code on your PATH and uses its
sign-in, so the subscription pays for each run; an `ANTHROPIC_API_KEY` in the
shell is not passed on, and `ghost doctor` warns about it.

Scan the QR code with the phone's camera to open the app with the server's
address and pairing token saved, then sign in with Bungie. Every request but
`/health` and Bungie's sign-in redirect needs that token, and requests through
the tailnet must come from the tailnet login that owns this machine (recorded
in `config.env` as `GHOST_TAILSCALE_USER` on the first start). The address and
token can also be changed by hand in the app's settings.

### Working on Ghost

```sh
bun install
bun run server   # serve on the tailnet, then run the server from source with reload
bun run ghost -- doctor   # any CLI command, from source

# app (needs a development build: @expo/ui has native code, so Expo Go won't do)
cd apps/mobile
bunx expo run:ios     # or: bunx expo run:android
```

`bun run server` reads `packages/server/.env` (copy `.env.example`), not
`~/.ghost/config.env`.

## Installing the app on your phone

There is no App Store build. Build it yourself and install it over a cable, or
install a build someone shared with you from EAS.

### Build and install from a clone

```sh
bun install
bun run app:ios       # Mac with Xcode, iPhone plugged in
bun run app:android   # JDK 17+, Android SDK, phone with USB debugging on
```

Each command checks what the build needs first (Xcode, CocoaPods and a signing
certificate for iOS; a JDK, the Android SDK and an authorized phone for
Android) and says how to fix anything missing. Then it builds in Release and
installs on the phone. A Release build carries its JavaScript inside the app,
so it runs on its own without Metro. Add `--clean` to regenerate `ios/` or
`android/` from scratch, for example after changing the app id.

The first run asks for an **app id** (for example `com.alex.ghost`) and saves
it in `apps/mobile/.env.local`, which git ignores. It becomes the iOS bundle id
and the Android package. On iOS a bundle id belongs to the first Apple team
that registers it, so each person needs their own.

**iOS signing.** iOS only runs apps signed by a certificate Apple issued, for a
provisioning profile that lists the bundle id and this phone. A free Apple ID
is enough: add it in Xcode > Settings > Accounts, and Xcode creates the
"Apple Development" certificate and the profile for you. If you have several
teams, put `APPLE_TEAM_ID=XXXXXXXXXX` in `apps/mobile/.env.local` to skip the
question. On the phone, turn on Settings > Privacy & Security > Developer Mode,
and after the first install trust your Apple ID under Settings > General >
VPN & Device Management. With a free Apple ID the profile expires after 7 days;
run the command again to refresh it. A paid account lasts a year.

**Android signing.** Android installs any app signed with any key, but an
update must be signed with the same key as the installed copy. The release
build here is signed with the debug key that `expo prebuild` generates, which
is fine for your own phone. Uninstall it before installing a build signed with
a different key, such as one from EAS.

### Share ad-hoc builds with EAS

This is how to give builds to friends without the App Store, Play Store or
TestFlight. Nothing personal is committed: the EAS project id comes from your
environment, and signing credentials live on EAS's servers.

1. Create the EAS project, and give it your app id and project id without
   committing either:

   ```sh
   eas login
   eas init     # prints the project id; it cannot write it into app.config.ts
   echo 'GHOST_APP_ID=com.you.ghost' >> apps/mobile/.env.local
   echo 'EAS_PROJECT_ID=<id>' >> apps/mobile/.env.local
   eas env:create --environment preview --name GHOST_APP_ID --value com.you.ghost --visibility plaintext
   eas env:create --environment preview --name EAS_PROJECT_ID --value <id> --visibility plaintext
   eas env:create --environment preview --name UPDATES_URL --value https://u.expo.dev/<id> --visibility plaintext
   ```

   `.env.local` is for your machine and the EAS variables are for the build
   server; both need the same values. Without `GHOST_APP_ID` the app id falls
   back to the placeholder `com.example.ghost`, which is not meant to be signed.

2. Register each friend's iPhone. iOS ad-hoc builds only install on devices
   listed in the provisioning profile, at most 100 per device type per year on
   a paid Apple Developer account (ad hoc needs a paid account):

   ```sh
   eas device:create   # gives a link or QR code; your friend opens it on their iPhone
   ```

3. Build:

   ```sh
   eas build --profile adhoc --platform all
   ```

   The first iOS build asks you to sign in to Apple. EAS creates the
   distribution certificate and an ad-hoc profile with the registered devices
   and keeps them on its servers. Android builds an APK signed with a keystore
   EAS generates and keeps. Rebuild after registering a new iPhone, since the
   profile has to include it.

4. Share the build page link (or its QR code). On iPhone, open it in Safari and
   install, then turn on Developer Mode. On Android, download the APK and allow
   installing from the browser.

5. Ship JavaScript changes without a new build:

   ```sh
   bun run app:update --message "Fix vault search"
   ```

   This publishes the current JavaScript to the `adhoc` channel, using the
   `preview` EAS variables so it matches the builds. Installed builds download
   it the next time they open and run it the launch after that. Only builds
   made after `UPDATES_URL` was set check for updates, so the first time you
   need one more `eas build`. An update also only reaches builds with the same
   native code (the runtime version is a fingerprint of it), so after adding a
   native library or changing `app.config.ts` plugins, build again instead.
   Builds from `bun run app:ios|android` have no `UPDATES_URL` and never update.

`eas credentials` shows or downloads what EAS stores. If it writes a local
`credentials.json` or `credentials/` folder, git ignores both.

## Chat is the app

The app follows "Ghost - App Map v2": chat is the main screen and everything
else sits behind one control, your Guardian's power in the top right.
Barlow Condensed for headings, Barlow for sentences, JetBrains Mono for data,
and chamfered corners instead of rounded ones.

- **Chat**: every request you've made, oldest first. Ghost's briefing sits where
  the current session starts: what changed since you last played ("Since last
  night: 11 new items, two of them beat what you have on. Postmaster is at 9 of
  21.") plus the two most useful follow-ups. Answers are a sentence, an optional
  plan block (rows you can untick, one confirm, undo afterwards) and the sources
  the answer relied on, with their age.
- **Menu** (tap your power): switch character, then Guardian, Vault, Recent and
  History, each with its one number.
- **Guardian**: equipped gear as one ledger, stats as tier bars, and one Ghost
  suggestion that returns to chat with it queued.
- **Vault**: search by name, perk or type; category, rarity, element, class
  armor, dupes, junk, new and unlocked filters; sort by power, newest, stat
  total or name. Ghost's flagged list lets you tick and tag junk.
- **Cleanup mode** (Vault, or ask "Clean up my vault"): Ghost moves what your
  character carries to the vault, then hands junk over in batches that fill
  every slot to nine. You delete in game; the server re-reads your inventory
  every 5 seconds and sends the next batch once the current one is gone. KEEP
  on any item sends it back untagged, and at the end your other gear can return.
  Bungie's API can't delete items, so Ghost never does.
- **Recent**: everything that arrived in the last 48 hours, grouped by arrival,
  with upgrades flagged, keep / junk on each row, and undo for batches Ghost moved.
- **History**: every call Ghost made, grouped by request, with undo.

## How a request flows

1. The app creates a **job** (`POST /jobs`) with the prompt and the selected
   character. The server stores it in SQLite and returns at once.
2. One background fiber runs queued jobs through the **Claude Agent SDK**, which
   uses the `claude login` on the machine, so the subscription pays for it.
3. The agent reads the account through the **ghost MCP server** (`get_characters`,
   `search_items`) and never mutates it. To change anything it calls
   `present_plan`; the plan is saved on the job and shown in chat.
4. When you confirm, `POST /jobs/:id/apply` runs the ticked rows itself (pull,
   transfer, equip, tag junk), journals every Bungie call in `actions`, and
   `POST /jobs/:id/undo` replays the journal backwards.

## Where Ghost's Destiny knowledge comes from

Roll, build and mod advice must come from data fetched for the answer, not from
model memory, and every answer lists its sources with their age.

- **God rolls**: DIM's default community wishlist,
  [`voltron.txt`](https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt)
  from 48klocs/dim-wish-list-sources (the list DIM loads by default, per that
  repo's README and DIM's wiki). The server refreshes it at most every 12 hours
  with a conditional request and keeps each roll's curator section, URL and date,
  so a citation points at the original source. `check_rolls` matches your actual
  perks (enhanced perks count as their base perk) and derives the roll score.
- **Junk**: the server judges it, not the agent. `find_junk` never flags gear
  that is locked, masterworked, equipped, crafted, marked keep, in a saved build
  or in-game loadout, or a wishlist roll. Copies of the same weapon (or armor of
  the same class, slot, set, top three stats and tuned stat) are ranked by gear
  tier, then wishlist score (armor by stat total), then power. Only the best copy
  is kept; every other copy is junk and ticked, as is any copy with a higher-tier
  copy in the same role whatever its tuning. A copy picked up in the last two
  days, tier 5 armor whose tuned stat could not be read, and a trash roll with no
  better copy are listed unticked for review. `bun scripts/junk-eval.ts`
  prints the verdicts for the account in `GHOST_DATA_DIR` without writing to
  Bungie.
- **Perk, mod, fragment and aspect effects**: `describe_plugs` reads descriptions
  from the current patch's Bungie manifest.
- **Meta**: the agent may use web search and fetch, preferring sources from the
  last 60 days, and must name the season or date of what it cites.
- **Creator videos**: every 6 hours the server reads the RSS feed of each channel
  in `GHOST_YOUTUBE_CHANNELS` (default `@Datto,@CammyCakes,@FalloutPlays,Aegis
Destiny 2`; an @handle, a `UC…` channel id, or a name to search for; empty turns
  it off). Each new upload from the last 60 days is summarized once into short
  claims with the second they are said, and every gear name in a claim is checked
  against the manifest: a claim whose names are all unknown (misheard captions,
  invented items) is dropped. `search_creator_notes` returns them with channel,
  video, date and a link to that moment. Captions need
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) on the server's PATH
  (`brew install yt-dlp`); without it only the video description is used and the
  note says so. Notes older than 60 days are deleted.

## Caching

- **Server**: the Bungie profile is cached for 30 seconds and concurrent requests
  share one load; the cache is dropped after any item move. Memberships are cached
  for the process. The manifest is checked for a new version at most hourly and
  lookups are memoised. Every fresh profile also syncs `items_seen`, which is what
  makes Recent and the "since last" briefing work without the agent.
- **App**: TanStack Query in memory, persisted to SQLite (`expo-sqlite/kv-store`)
  for a week, so the app opens on the last known chat, vault and briefing while
  it refetches. The chat polls fast only while a job is running.
- **Lists**: every list is a LegendList (`@legendapp/list`), virtualised and,
  where rows share a shape, recycled.

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

**The agent proposes, the server acts.** The agent's tools only read. A plan is
data the player can inspect and untick, and the server executes it
deterministically, which is what makes undo and the History log possible.

**Designed screens, native navigation.** The design is a custom dark UI (tier
colors, mono labels, chat bubbles) that neither SwiftUI's nor Compose's stock
components produce, so screens are plain React Native views styled from
`src/constants/theme.ts`. Navigation stays native: menu pages are stack screens
with the system back swipe, and settings is a native sheet.

## Status

- Bungie OAuth needs an https redirect URL registered on bungie.net; the
  callback route has not been exercised against Bungie yet.
- Everything that needs a linked account (profile sync, briefing contents, plan
  apply and undo against real items) is typed and unit-tested on fixtures but
  has not run against a live account.
- Dismantle is not possible: Bungie's API has no endpoint for it, so cleanup tags
  items as junk.
- The app now needs a fresh development build (`expo-sqlite` is a new native
  module).
