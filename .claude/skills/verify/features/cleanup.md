# Cleanup mode

Ghost empties what the character carries into the vault, then hands junk to the player in batches that fill every inventory slot to nine. The player deletes those in game; the server re-reads the inventory every 5 seconds and sends the next batch once the current one is gone. KEEP returns an item untagged, and at the end the stashed gear can come back. Bungie has no delete endpoint, so Ghost never deletes.

## Sub-features

- `cleanup-preview` what a cleanup would do: junk to delete, gear stashed first, vault after (`GET /cleanup/preview`).
- `cleanup-review` items to review before starting, with `KEEP` / `JUNK` (`GET /cleanup/review`).
- `cleanup-start` stash then deliver (`POST /cleanup/start`). Writes to Bungie.
- `cleanup-control` pause, resume, skip, stop, return, close (`POST /cleanup/:id/<command>`). Writes to Bungie.
- `cleanup-keep` and `cleanup-deleted` mark items kept, or deleted by hand before Bungie's profile catches up.

## How to get to it (user POV)

- Vault, `CLEAN UP`.
- Chat: ask "Clean up my vault"; the answer carries an offer card with `OPEN CLEANUP`, `NOT NOW`, `START CLEANUP`.

## Driving it with ghost-verify and argent

Preconditions:

- Linked instance. Starting a cleanup moves real items; only do it when the user agreed in this conversation.

- **Preview.** `$V api GET /cleanup/preview` and `$V api GET /cleanup/current` (no session: null). In the app, the cleanup screen shows the crumb `VAULT › CLEANUP`, headline `CLEAN UP MODE`, sections `STASH`, `DELIVER`, `RETURN`, and buttons `NOT NOW` and `START CLEANUP`.
- **Review.** `$V api GET /cleanup/review`; the app lists rows with `KEEP` and `JUNK`, and `ASK GHOST TO TAG JUNK` when nothing is tagged yet.
- **Start (agreed runs only).** Tap `START CLEANUP`; the crumb becomes `CLEANUP › STEP 1 OF 2` with `STASHING` / `Carried gear → vault`. `$V sql "select id, stage, created_at from cleanup_sessions"` shows the session, and `server.log` shows the transfers.

## Gotchas

- `NOT NOW` navigates back to the vault without a request; it is not proof of anything server-side.
- The watcher polls the profile every 5 seconds during a session, which spends Bungie requests; `down` stops it.
- `/cleanup/*` commands on an unlinked instance stop at 409.
