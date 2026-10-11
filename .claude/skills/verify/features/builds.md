# Saved builds

The player keeps builds Ghost proposed, browses them in the Builds screen, opens one to see its subclass, stats and pieces, renames it or swaps pieces in Edit Build, links it to one of the character's in-game loadout slots, equips it, or deletes it.

## Sub-features

- `builds-list` lists saved builds with search and filter, and counts how many are in game.
- `builds-detail` opens a build sheet: subclass, stat table, pieces, readiness.
- `builds-edit` renames a build, changes what it is for, or removes and swaps pieces (`PATCH /builds/:id`).
- `builds-options` lists the gear that can go in a slot while editing (`GET /builds/:id/options`).
- `builds-link` links the build to an in-game slot, taking the slot's gear (`PUT /builds/:id/link`), or unlinks it (`DELETE /builds/:id/link`).
- `builds-save` saves a build from a chat answer (`POST /builds`).
- `builds-equip` equips it on the character (`POST /builds/:id/equip`). Writes to Bungie.
- `builds-remove` deletes it (`DELETE /builds/:id`).

## How to get to it (user POV)

- Drawer row `BUILDS, <n> saved`, then a build row (label `<name>, <class> · <subclass>, <exotic>`).
- From a chat answer that proposed a build: its card opens Save Build (`SAVE`, or `SAVE & REVIEW` when "In game" is chosen).
- In the build sheet: `LINK SLOT` (`SAVE TO SLOT` when already linked) opens the slot picker; "Use the slot's gear" then `LINK` links, "Put this build in the slot" then `REVIEW` proposes an equip plan.

## Driving it with ghost-verify and argent

Preconditions:

- Linked instance; `$V api GET /builds` returns at least one build. The player's database holds two today ("Weaken sword, overshield loop" and "PvP Skullfort").

- **List.** `$V api GET /builds | tail -1 | jq -r '.[] | "\(.id) \(.name)"'`. In the app, open the drawer and tap `BUILDS, 2 saved`; the header reads `BUILDS` with the count, and each build is a row.
- **Read the kept pieces.** The edit payload needs every piece the build keeps: `$V api GET /builds | tail -1 | jq -c --arg id <id> '.[] | select(.id == $id) | [.plan.rows[] | select(.action == "equip" or .action == "none") | .itemInstanceId]'`.
- **Rename over the API.** `$V api PATCH /builds/<id> '{"name":"<new>","purpose":<current purpose or null>,"items":[<kept ids>]}'` returns `200` with the new name. Same ids means only the name and purpose change and Bungie is not read. Then `$V sql "select name, updated_at from saved_builds where id = '<id>'"`.
- **Rename in the app.** Tap the build row; the sheet shows the name in capitals with `EQUIP`, `EDIT`, `DELETE`. Tap `EDIT` (the one inside the sheet, near the bottom); the `EDIT BUILD` sheet has the name field (its value is the current name) and `FOR`. Tap the right end of the name field and wait for `Clear text` to appear, edit with `backspace` and typed text, press `enter`, wait for `Clear text` to go `hidden`, tap `SAVE`. Wait for the sheet heading to read the new name in capitals (`await-ui-element` with `condition: visible`). The `$V sql` above shows the new name, and `server.log` has a `PATCH /builds/<id> 200` line.
- **Swap a piece.** In `EDIT BUILD`, each slot (`KINETIC`, `ENERGY`, `POWER`, `HELM`, `ARMS`, `CHEST`, …) has `REMOVE` and `SWAP`. `SWAP` lists candidates from `GET /builds/<id>/options?slot=<slot>`, each labelled `Use <item name>`. After `SAVE`, `plan.rows` in `GET /builds` holds the new instance id.
- **Link a slot.** `$V api GET /loadouts?characterId=<id>` lists the slots. `$V api PUT /builds/<id>/link '{"characterId":"<id>","index":<n>}'`; then `GET /builds` shows `inGame` set and `$V sql "select in_game_character_id, in_game_index from saved_builds where id = '<id>'"` matches. In the app the build list header shows `<n> in game`.

## Gotchas

- `PATCH` with a different item set reworks the plan against the live inventory and fails with `PlanNotApplicable` when the build's class has no character.
- `readiness` is null when Bungie could not be reached, so a list that loads is not proof that Bungie answered; check `health` reports `bungieLinked: true`.
- "Put this build in the slot" and `EQUIP` lead to plans whose confirm moves real gear. Stop at the review screen unless the user agreed.
- The build sheet and the list underneath appear in the same accessibility tree; the sheet's `EDIT` is the one inside the sheet frame (near the bottom), not a list row.
