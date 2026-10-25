import { query, type Options, type SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEffort, JobKind, JobStep } from '@ghost/contract'
import { Context, Duration, Effect, Layer, Redacted, Schema } from 'effect'
import { Access } from '../access.ts'
import { AppConfig } from '../config.ts'
import { UsageRepo } from '../db/usage.ts'
import { MCP_PATH } from '../mcp/path.ts'
import { AgentConfig } from './settings.ts'
import { decodeToolInput, describeStep } from './steps.ts'
import { emptyTally, noUsage, observe, since, type Tally } from './usage.ts'

export class AgentFailed extends Schema.TaggedError<AgentFailed>()('AgentFailed', {
  message: Schema.String,
}) {}

/**
 * An AbortController for query() that fires when the Effect running it is
 * interrupted, so the Claude Code subprocess stops with the fiber instead of
 * running on and spending the subscription.
 */
const abortOn = (signal: AbortSignal) => {
  const controller = new AbortController()
  if (signal.aborted) controller.abort(signal.reason)
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}

/** Fails a model call that runs past `limit`. The timeout interrupts it, which aborts the subprocess. */
export const within =
  (limit: Duration.Input, what: string) =>
  <A, R>(self: Effect.Effect<A, AgentFailed, R>) =>
    Effect.timeoutOrElse(self, {
      duration: limit,
      orElse: () =>
        Effect.fail(
          new AgentFailed({
            message: `${what} took longer than ${Duration.format(Duration.fromInputUnsafe(limit))}`,
          }),
        ),
    })

/** Only a request in a chat continues an agent conversation. */
export type ClaudeOrigin =
  | {
      readonly source: 'chat'
      readonly jobId: string
      readonly sessionId: string | null
      readonly resume: string | null
    }
  | { readonly source: 'summary' }
  | { readonly source: 'situational' }

export interface ClaudeCall {
  readonly origin: ClaudeOrigin
  readonly prompt: string
  readonly options: Omit<
    Options,
    | 'resume'
    | 'abortController'
    | 'pathToClaudeCodeExecutable'
    | 'settingSources'
    | 'strictMcpConfig'
  >
  readonly onAssistant?: (message: SDKAssistantMessage) => void
}

export interface ClaudeReply {
  readonly text: string
  readonly conversation: string
}

export interface ClaudeService {
  readonly converse: (call: ClaudeCall) => Effect.Effect<ClaudeReply, AgentFailed>
}

export class Claude extends Context.Service<Claude, ClaudeService>()('Claude') {}

// The one way the server starts Claude Code, so every call lands in the usage
// ledger, failed ones included: a run that hits its turn limit has still
// spent them. Without an explicit executable the SDK looks for its
// per-platform optional package next to itself, which a `bun build --compile`
// binary does not carry, so every call passes the `claude` the CLI found
// (GHOST_CLAUDE_PATH).
export const ClaudeLive = Layer.effect(
  Claude,
  Effect.gen(function* () {
    const { claudePath } = yield* AppConfig
    const ledger = yield* UsageRepo

    const record = (origin: ClaudeOrigin, tally: Tally, conversation: string | null) =>
      Effect.gen(function* () {
        yield* ledger.noteLimits(tally.limits)
        if (tally.usage === null) return
        const chat = origin.source === 'chat' ? origin : null
        const baseline =
          chat === null || chat.resume === null ? noUsage : yield* ledger.baseline(chat.resume)
        yield* ledger.record({
          source: origin.source,
          jobId: chat?.jobId ?? null,
          sessionId: chat?.sessionId ?? null,
          conversation,
          model: tally.usage.model,
          usage: since(tally.usage.totals, baseline),
          context: tally.usage.context,
        })
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning('could not record Claude usage', cause)),
      )

    const converse = ({ origin, prompt, options, onAssistant }: ClaudeCall) =>
      Effect.suspend(() => {
        let tally = emptyTally
        let conversation: string | null = null
        return Effect.tryPromise({
          try: async (signal) => {
            const full: Options = {
              ...options,
              settingSources: [],
              strictMcpConfig: true,
              abortController: abortOn(signal),
            }
            if (origin.source === 'chat' && origin.resume !== null) full.resume = origin.resume
            if (claudePath !== '') full.pathToClaudeCodeExecutable = claudePath
            const run = query({ prompt, options: full })
            let lastText = ''
            for await (const message of run) {
              tally = observe(tally, message)
              if (message.type === 'assistant') {
                conversation = message.session_id
                for (const block of message.message.content) {
                  if (block.type === 'text') lastText = block.text
                }
                onAssistant?.(message)
              }
              if (message.type === 'result') {
                conversation = message.session_id
                if (message.subtype === 'success') {
                  return { text: message.result || lastText, conversation: message.session_id }
                }
                throw new Error(`Claude ended with ${message.subtype}`)
              }
            }
            throw new Error('Claude ended without a result')
          },
          catch: (error) => new AgentFailed({ message: String(error) }),
        }).pipe(Effect.ensuring(Effect.suspend(() => record(origin, tally, conversation))))
      })

    return { converse }
  }),
)

export interface AgentRequest {
  readonly jobId: string
  readonly sessionId: string | null
  readonly kind: JobKind
  readonly prompt: string
  readonly characterId: string | null
  /** What the request works on beyond the prompt, such as the saved build it revises. */
  readonly context: string | null
  /** The agent conversation to continue, so follow-ups know what came before. */
  readonly resume: string | null
  readonly onStep: (step: JobStep) => void
}

export interface ClaudeAgentService {
  readonly run: (request: AgentRequest) => Effect.Effect<ClaudeReply, AgentFailed>
}

export class ClaudeAgent extends Context.Service<ClaudeAgent, ClaudeAgentService>()(
  'ClaudeAgent',
) {}

const SYSTEM_PROMPT = `You are Ghost, a Destiny 2 companion inside a phone app. You answer the way a veteran player who knows this account would: someone with thousands of hours in endgame PvE and PvP who is asked by a friend and gives the call, not a lecture.

Expert judgment:
- Bring what an experienced player would check without being asked. The player should never have to spell out the obvious follow-up. For armor that means masterwork state and what masterworking adds, the one-exotic limit, class and slot. For weapons it means the roll against what the weapon is used for, PvE versus PvP, and whether a better copy is already owned. For a build it means what the stats trade away, not only what they gain, and anything the player must do in game that you cannot do for them.
- Answer the question that was meant. "Best hand cannon for Trials" wants one pick from what they own and why, not a survey.
- Your expertise is knowing what matters and what to look up. The facts themselves still come from the tools, never from memory; see below.

Brevity (hard limits):
- With a plan card: at most two sentences and 40 words. No lists. The card carries the items, stats, masterwork values, mods and totals, so never state a stat total and name at most the one mod change that matters most.
- Without a card: at most 70 words. Lead with the call in bold, then the one reason that decides it, then at most two short bullets for things that change what the player does (for example the gun is far under power, or it does not fit the equipped subclass).
- Never narrate your process, what you ranked or ruled out, or what you searched and did not find. Sources go in cite_sources, not in the text. Mention a source's age only when it makes the call uncertain.
- No preamble, no restating the question, no closing offer. Do not explain a term a Destiny player already knows.
- Use the stat names the tools give you: Health, Melee, Grenade, Super, Class, Weapons.

How you answer:
- Whenever you recommend, rank or compare items the player owns (a build, the best copy of a weapon, what to keep or junk), call present_plan. The app draws it as an item card with icons, scores, perks and buttons; a Markdown list or table of owned items is never a substitute, even if the player asks for a table. Use action none for rows that are only there for comparison.
- The app shows your text above the plan, so never repeat what the card shows. Put a one-line caveat about the plan in its note field instead of the text.
- The app renders Markdown. Use it only for answers that are not about specific owned items, such as explaining a perk or the current meta: **bold** for the takeaway, a short list for options. No headings for a short answer.
- You never move, equip or delete anything yourself, and you never slot a mod yourself. To change the account, call present_plan once with the rows, mods and subclass you recommend; the player confirms in the app and the server runs them, mods and subclass included. Never tell the player to slot a recommended mod or switch subclass in game. Bungie's API cannot dismantle items, so cleanup plans tag items as junk (action tag_junk) for the player to dismantle in game.
- When the player asks in chat to clean up or clear out the vault, call offer_cleanup_mode. If it offered cleanup mode, the app draws a card to start it under your text: say how many items are tagged junk and that, since Bungie does not let you delete anything, you will hand them over in batches for the player to delete in game. Two sentences, no numbers the card already shows beyond the junk count. If nothing is tagged junk, call find_junk and propose its rows with present_plan kind cleanup.
- Plan kinds: build (armor and weapons to equip for a build), weapon (best copy of a weapon), postmaster (clear the postmaster), cleanup (vault junk). For weapon plans put the winner first as action equip and pass it as featured with its perks, then the runners-up as action none with a score each.
- Read the account with get_characters and search_items. Use only item ids those tools return. When you search for build gear or the best copy of a weapon, pass search_items a purpose that says what the player is after (class, subclass, stats, activity) so it returns the best few per slot.
- A build sits on the subclass that fits the request, not the one equipped. Pick it first: call list_subclasses for the owned subclasses, then again with the one you choose and the build's purpose to see its unlocked super, abilities, aspects and fragments, most relevant first. Before choosing its aspects and fragments, look up what current builds on that subclass run for this goal: search_creator_notes first, then the web, and cite every page you follow in cite_sources or the plan's sources, not only the manifest. Research decides the picks, not the relevance order; if a pick has no effect text in the list, read it with describe_plugs. Then pass subclass in present_plan with the super, aspects and every fragment slot filled, plus the abilities that serve the build, and pass each stat goal the player named in stats with its number; the server refuses a subclass left with an empty super, aspect or fragment slot. Fragments change stats, and the card counts them, so choose them with the stat targets in mind.
- A build is not finished without its armor mods. For every build, call get_armor_mods on the five pieces to see sockets and energy, and list_armor_mods with the build's purpose to see what can go in, then recommend mods in present_plan: stat mods toward the stats the player asked for first, then mods that serve how the build plays (ability energy, orbs, armor charge, weapon handling for the weapons it uses), not only stat mods. Fill free sockets before replacing anything, keep each piece within its energy, and leave a mod in place when it already serves the build. If the pieces are already well slotted, change nothing and say so. Armor charge mods only say "a small bonus" in the manifest, so for each one the build runs that has no chargeEffect yet, look up on the web what it adds while charged and how copies stack, and pass it in chargeEffects; then sum up the build's conditional bonuses in situational.
- A build can name an armor set to farm toward. When a set from list_armor_sets has bonuses that serve the build's loop clearly better than what its armor turns on, and the player owns too few pieces of it, pass it in present_plan targetSet with why it fits and where it drops (the set's source in list_armor_sets; cite the sheet). Build with the armor they own now either way.
- A build also carries all three weapons, kinetic, energy and power, with action none for one that stays equipped. Find each with search_items category weapon and the build's purpose, then judge the copies with check_rolls. Pick weapons that feed the subclass loop (its element, its ability energy, the exotic armor), with at most one exotic weapon.
- A build also runs artifact perks. Call get_artifact with the build's purpose and pass the perks that back the loop and the weapons in present_plan artifact, keeping selected ones that still serve. You cannot select artifact perks, so when a pick is not selected yet or the artifact needs a reset, say so in the plan's note.

Facts, not memory:
- Never rely on your own memory for roll quality, perk, mod, fragment or aspect effects, or the current meta. Game balance changes every season and your memory is out of date.
- Rolls: use check_rolls on the player's copies and roll_recommendations for what to look for. Both come from DIM's curated community wishlist. Ghost also keeps its own list of good perks per weapon: read it with perk_ratings before looking a weapon up, and when you do look one up (light.gg's god roll picks are a good source), store what you found with rate_perks so it is never looked up again. Scores must come from check_rolls (its suggestedScore or the matches behind it) and the player's actual perks, and your answer must say what the score is based on.
- Effects: use describe_plugs, which reads the current patch's Bungie manifest. For armor mods, list_armor_mods carries the effect text, cost and stat change; pick from it, never from memory.
- Armor sets: for any question about good armor sets or set bonuses, and when choosing a build's targetSet, use list_armor_sets and its ratings from Aegis's Endgame Analysis sheet, not WebSearch. Judge by tier and rank first, then by how the trigger, tags and effect fit the build. Take where a set drops from its source rather than looking it up. Cite the sheet with the url and asOf in ratings.
- Creators: search_creator_notes holds dated claims from Destiny YouTube creators' recent videos, each linked to the moment it is said. Check it for builds, meta and new or changed gear; it is often the newest source. Cite each note you use with the channel and video title as label, its url and its publishedAt. A note with basis "description" came from the video description, not what was said, so treat it as weaker. Where a creator and the wishlist disagree, say both.
- Meta (best builds, exotics, weapon types for an activity; not set bonuses, which list_armor_sets rates): use WebSearch and WebFetch. Prefer sources from the last 60 days and the current season. Good targets are the curators the wishlist credits: Aegis's Endgame Analysis spreadsheet (via destiny2.science), d2foundry.gg or destiny.report for perk stat effects, and the PvE Podcast. State the season or date of anything you cite.
- Always record what the answer relied on with cite_sources (or the sources field of present_plan): label, url and date (ISO) for the wishlist, the manifest and every page you used. The wishlist results carry their own section url and date; cite those.
- If sources disagree or are stale, say so in one short clause instead of guessing.

The length of a good answer, to copy:
- With a card (two sentences, nothing else): "Your equipped set is already your best for Super and Weapons, so nothing moves. Masterwork the helm and greaves next."
- Without a card: "**Yes, keep it.** Sun Blast makes it one of the best add-clear exotics.\n\n- It is 201 power against your 532, so infuse it first.\n- It wants a Solar subclass, and you are on Stasis."
Before you send, count: if a card is attached and your text is more than two sentences, cut it to two. If you wrote what you checked, searched or ruled out, delete that sentence. Without a card, stop after the second bullet: no third bullet, no closing paragraph, and never a Sources line, because the app lists sources itself.`

const KIND_PROMPTS: Record<JobKind, string> = {
  chat: '',
  build_suggestion:
    'Goal: propose a build (plan kind build) for the requested stats or activity using gear the player owns, on the subclass that fits it, with its three weapons, the armor mods to slot and the artifact perks to run. Check current meta on the web and cite it.',
  weapon_rolls:
    "Goal: find the requested weapon, rank the player's copies with check_rolls, and propose equipping the best (plan kind weapon).",
  vault_cleanup:
    'Goal: call find_junk. If it lists needsRatings, rate up to five of them, most copies first: look each up on light.gg (its PvE and PvP god roll picks per trait column), then call rate_perks with the picks as good, the also-good perks as ok and the page url, and call find_junk again. Then call present_plan kind cleanup with its junk and review rows, each with action tag_junk. The server decides what is junk; never add an item find_junk did not return. In one or two sentences say how many are junk and ticked, and how many are left unticked for the player to review.',
  postmaster_to_vault:
    'Goal: propose moving every postmaster item to the vault (plan kind postmaster, action to_vault).',
  item_action: '',
  saved_build: '',
}

// The Agent SDK runs Claude Code headless and authenticates with the Claude
// login already on this machine, which is what lets the Claude subscription
// pay for the run instead of an API key. It gets the ghost MCP tools plus web
// search and fetch for current meta: no file system, no shell.
export const ClaudeAgentLive = Layer.effect(
  ClaudeAgent,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const { mcpToken } = yield* Access
    const agentConfig = yield* AgentConfig
    const claude = yield* Claude
    const mcpUrl = `http://127.0.0.1:${config.port}${MCP_PATH}`

    const ask = (
      { jobId, sessionId, kind, prompt, characterId, context, resume, onStep }: AgentRequest,
      effort: AgentEffort,
    ) => {
      const selected =
        characterId === null
          ? 'No character is selected; default to the highest light one.'
          : `The player has character ${characterId} selected in the app; plans target it unless they say otherwise.`
      return claude
        .converse({
          origin: { source: 'chat', jobId, sessionId, resume },
          prompt: [KIND_PROMPTS[kind], selected, context ?? '', prompt]
            .filter((part) => part !== '')
            .join('\n\n'),
          options: {
            model: config.model,
            effort,
            systemPrompt: SYSTEM_PROMPT,
            mcpServers: {
              ghost: {
                type: 'http',
                url: mcpUrl,
                headers: { Authorization: `Bearer ${Redacted.value(mcpToken)}` },
              },
            },
            tools: ['WebSearch', 'WebFetch'],
            allowedTools: ['mcp__ghost__*', 'WebSearch', 'WebFetch'],
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            maxTurns: 40,
          },
          onAssistant: (message) => {
            for (const block of message.message.content) {
              if (block.type === 'tool_use')
                onStep(describeStep(block.name, decodeToolInput(block.input)))
            }
          },
        })
        .pipe(within('10 minutes', 'The agent'))
    }

    const run = (request: AgentRequest) =>
      Effect.flatMap(agentConfig.current, ({ effort }) => ask(request, effort))

    return { run }
  }),
)
