# Vault

The player searches the vault by name, perk or type, filters and sorts it, opens an item, picks several to ask Ghost about or junk, and reviews Ghost's flagged list (dupes and low rolls) before tagging junk. CLEAN UP starts cleanup mode (cleanup.md).

## Sub-features

- `vault-list` shows count and capacity and every item (`GET /vault`).
- `vault-search` filters by the `Name, perk or type` field.
- `vault-filter` opens the filter and sort sheet (`/vault-filter`).
- `vault-item` opens an item sheet (`GET /items/:id`, `/items/:id/sheet`, `/items/:id/perks`).
- `vault-pick` selects items, then `ASK ABOUT <n>` (starts a chat job) or `JUNK <n>`.
- `vault-flagged` shows `FLAGGED <n>` with `DUPES` and `LOW ROLL` chips, `SELECT ALL` / `KEEP ALL`, and a confirm that tags the ticked rows.

## How to get to it (user POV)

- Drawer row `VAULT, <count> / <capacity>`.

## Driving it with ghost-verify and argent

Preconditions:

- Linked instance.

- **List.** `$V api GET /vault | tail -1 | jq '{count, capacity, items: (.items | length)}'`. The drawer row shows the same `count / capacity`.
- **Search.** In the app tap the `Name, perk or type` field and type a weapon name from the list; only matching rows remain. Search runs in the app; no request is logged for it.
- **Filter.** Tap the button labelled `Filter and sort, <n> filters on, sorted by <SORT>`; after choosing a filter the label's count goes up and a chip `<filter> ×` appears.
- **Item.** Tap a row; `server.log` shows `GET /items/<id>` and the sheet shows the item's name and perks.

## Gotchas

- `GET /vault` is a Bungie read through the 30 second profile cache; two reads in a row can come from the cache.
- Confirming the flagged list tags junk on the real account (it goes through the plan executor). Stop before the confirm button unless the user agreed.
- Unlinked, `GET /vault` returns `409 {"_tag":"BungieNotLinked"}`; that proves the guard, not the vault.
