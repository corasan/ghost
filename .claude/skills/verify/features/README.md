# Ghost verification map

The maintained list of what a player can do in Ghost and how to prove each one. Read this index, then follow the matching feature file. A change is verified only through the entry points its feature file lists; driving one convenient route when the file lists others is a partial proof, and the report says which entry points were skipped.

| Feature | File | Needs | Writes to Bungie? |
| --- | --- | --- | --- |
| Saved builds: list, edit, link to an in-game slot | [builds.md](builds.md) | `up --linked` | Only Equip and "Put this build in the slot" |
| Recent items with keep / junk | [recent.md](recent.md) | `up --linked` | No |
| Vault browse, filter, flagged junk | [vault.md](vault.md) | `up --linked` | Tagging flagged junk |
| Chat: ask Ghost, get an answer and a plan | [chat.md](chat.md) | `up --linked`, Claude login | Only when a plan is confirmed |
| Cleanup mode | [cleanup.md](cleanup.md) | `up --linked` | Yes, from START CLEANUP on |

## Baseline preconditions

- `.claude/skills/verify/scripts/ghost-verify up --linked` printed `ready:` and `doctor` passes. Call the helper `$V` below.
- For app steps: `$V metro`, the dev-client link and then `$V link` opened with argent `open-url` on the booted iPhone simulator, and the chat screen shows the player's power in the top right.
- The linked snapshot's access token has at least 10 minutes left (printed by `up --linked`).

## Driving conventions

- API steps use `$V api` and `$V sql`. App steps use argent and take targets from the accessibility tree the previous action returned.
- Menu screens open from the drawer: tap `Open menu`, then the row whose label starts with the screen name.
- Reset what a recipe changed through the same route, for example rename a build back. The snapshot is thrown away by `down`, so this only matters within a run.

## Proof

- Each step pairs the player action with the state after it: the API response and a follow-up read, or the screen before and after.
- A stored change is shown by `$V sql` against the snapshot and by `server.log`. In a linked run, the same query against `~/.ghost/data/ghost.sqlite` (with `sqlite3 -readonly`) must still show the old value.
- Copy app screenshots that prove a step into the evidence dir as `NN-app-<what>.png`.
- An entry point that could not be reached is reported with the command tried and the precondition that was missing.

## Feature file contract

Each file has an H1, one paragraph on what the player sees, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with ghost-verify and argent` (starting with `Preconditions:`), and `Gotchas`.
