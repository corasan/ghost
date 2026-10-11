# Chat

Chat is the main screen. It opens on Ghost's briefing (date, character, what changed since the last session, a follow-up such as `CLEAR POSTMASTER`, and `TRY ASKING` suggestions). The player asks a question; Ghost answers with a sentence, an optional plan whose rows can be unticked, and its sources. Confirming a plan applies it to the account, and undo replays the journal backwards.

## Sub-features

- `chat-briefing` the opening briefing (`GET /briefing`).
- `chat-ask` a request becomes a job that the Claude agent runs (`POST /jobs`, then `GET /jobs/:id` until `done` or `failed`).
- `chat-sessions` past conversations in the drawer under `CHATS`, and `NEW CHAT` (`GET /sessions`, `GET /jobs?sessionId=`).
- `chat-plan` a plan block with rows to untick, `COMPARE <n>`, `SELECT ALL` / `HOLD ALL`, and a confirm (`POST /jobs/:id/apply`). Writes to Bungie.
- `chat-undo` `UNDO` on an applied plan (`POST /jobs/:id/undo`). Writes to Bungie.
- `chat-history` every Bungie call Ghost made, grouped by request (`GET /history`).

## How to get to it (user POV)

- App launch lands on chat; the drawer row `CHAT, Ghost` returns to it.
- Type in `Ask Ghost` and tap `Send`, or tap a `TRY ASKING` suggestion (`Best hand cannon for Trials`, `Void build, 100 Resilience, 100 Recovery`, `Clean up my vault`, `What did I get yesterday?`).
- `ASK ABOUT <n>` in the vault, and the Guardian screen's suggestion, start a chat job too.

## Driving it with ghost-verify and argent

Preconditions:

- Linked instance, and `claude` is signed in on this machine (the agent uses that login).
- The user knows a job spends Claude usage; ask first when the change does not need a live agent run.

- **Briefing.** `$V api GET /briefing`; the app's chat screen shows the same headline and follow-ups.
- **Ask.** `$V api POST /jobs '{"kind":"chat","prompt":"What did I get yesterday?"}'` returns the job with `status: "queued"`. Poll `$V api GET /jobs/<id>` every few seconds until `status` is `done` or `failed`; `result` holds the answer, `sources` what it relied on, `plan` any proposed changes. Then `$V sql "select status, kind from jobs where id = '<id>'"`.
- **Ask in the app.** Tap `Ask Ghost`, type the prompt, tap `Send`. The question appears at once and the answer replaces the working state when the job finishes; wait with `await-ui-element` on text from the answer, with a timeout of 120000.
- **Plan.** When `plan` is non-null the app shows its rows and a confirm button labelled from `plan.confirmLabel`. Unticking a row is local; only the confirm calls apply.

## Gotchas

- One worker runs jobs one at a time, so a second job waits behind the first.
- The agent's tools only read the account; nothing changes until the confirm. Do not confirm or undo in a linked run unless the user agreed.
- Jobs started in the snapshot also land in its `settings` as `agent.conversation.*` rows; they vanish with `down`.
