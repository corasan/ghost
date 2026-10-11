# Recent items

Everything that reached the account in the last 48 hours, grouped by arrival, with upgrades flagged. The player marks each item keep or junk, or undoes the mark; the mark is stored by Ghost, not Bungie, and feeds junk judging and the briefing.

## Sub-features

- `recent-list` lists items first seen in the last 48 hours (`GET /inventory/recent?characterId=`).
- `recent-filter` switches between `ALL`, `UNDECIDED` and `UPGRADES <n>`.
- `recent-decide` marks an item keep or junk, or clears the mark (`POST /inventory/recent/:id/decision`).

## How to get to it (user POV)

- Drawer row `RECENT, <n> new`.
- Chat's "What did I get yesterday?" suggestion answers from the same data (see chat.md).

## Driving it with ghost-verify and argent

Preconditions:

- Linked instance; `$V api GET /inventory/recent` returns at least one item.

- **List.** `$V api GET /inventory/recent | tail -1 | jq -r '.[] | "\(.itemInstanceId) \(.name) \(.decision)"'`. In the app the screen title is `RECENT` with subtitle `Last 48 hours` and chips `ALL`, `UNDECIDED`, `UPGRADES <n>`.
- **Decide.** `$V api POST /inventory/recent/<itemInstanceId>/decision '{"decision":"keep"}'` returns the item with `decision: "keep"`. In the app each row has buttons labelled `Keep` and `Junk`; a decided row shows `Undo decision`.
- **Stored.** `$V sql "select decision from items_seen where item_instance_id = '<id>'"` shows `keep`.
- **Undo.** `$V api POST /inventory/recent/<id>/decision '{"decision":null}'`, then the same query shows an empty decision.

## Gotchas

- The 48-hour window comes from `items_seen.first_seen_at` in the snapshot; a snapshot of a player who has not played recently lists nothing. Say so instead of reporting the feature broken.
- A decision invalidates the cached profile, so the next Bungie-backed read reloads it (slower, and it uses the access token).
