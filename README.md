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
bun run server                                          # serves on the tailnet and prints a pairing QR, then starts the server

# app (needs a development build: @expo/ui has native code, so Expo Go won't do)
cd apps/mobile
bunx expo run:ios     # or: bunx expo run:android
```

`bun run serve` prints the server's tailnet address and a QR code. Scan it with
the phone's camera to open the app with that address saved, then sign in with
Bungie. The address can also be changed by hand from the sign-in screen.

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
