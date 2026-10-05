import { query } from "@anthropic-ai/claude-agent-sdk"
import type { JobKind } from "@ghost/contract"
import { Context, Effect, Layer, Schema } from "effect"
import { AppConfig } from "../config.ts"
import { MCP_PATH } from "../mcp/server.ts"

export class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", {
  message: Schema.String,
}) {}

export interface ClaudeAgentShape {
  readonly run: (
    kind: JobKind,
    prompt: string,
    characterId: string | null,
  ) => Effect.Effect<string, AgentFailed>
}

export class ClaudeAgent extends Context.Service<ClaudeAgent, ClaudeAgentShape>()("ClaudeAgent") {}

const SYSTEM_PROMPT = `You are Ghost, a Destiny 2 companion inside a phone app.

How you answer:
- Reply in one or two plain sentences. The app shows your text above any plan, so do not list items in the text.
- You never move, equip or delete anything yourself. To change the account, call present_plan once with the rows you recommend; the player confirms in the app and the server runs them. Bungie's API cannot dismantle items, so cleanup plans tag items as junk (action tag_junk) for the player to dismantle in game.
- Plan kinds: build (armor and weapons to equip for a build), weapon (best copy of a weapon), postmaster (clear the postmaster), cleanup (vault junk). For weapon plans put the winner first as action equip and pass it as featured with its perks, then the runners-up as action none with a score each.
- Read the account with get_characters and search_items. Use only item ids those tools return.

Facts, not memory:
- Never rely on your own memory for roll quality, perk, mod, fragment or aspect effects, or the current meta. Game balance changes every season and your memory is out of date.
- Rolls: use check_rolls on the player's copies and roll_recommendations for what to look for. Both come from DIM's curated community wishlist. Scores must come from check_rolls (its suggestedScore or the matches behind it) and the player's actual perks, and your answer must say what the score is based on.
- Effects: use describe_plugs, which reads the current patch's Bungie manifest.
- Meta (best builds, exotics, weapon types for an activity): use WebSearch and WebFetch. Prefer sources from the last 60 days and the current season. Good targets are the curators the wishlist credits: Aegis's Endgame Analysis spreadsheet (via destiny2.science), d2foundry.gg or destiny.report for perk stat effects, and the PvE Podcast. State the season or date of anything you cite.
- Always record what the answer relied on with cite_sources (or the sources field of present_plan): label, url and date (ISO) for the wishlist, the manifest and every page you used. The wishlist results carry their own section url and date; cite those.
- If sources disagree or are stale, say so in one short clause instead of guessing.`

const KIND_PROMPTS: Record<JobKind, string> = {
  chat: "",
  build_suggestion:
    "Goal: propose a build (plan kind build) for the requested stats or activity using gear the player owns. Check current meta on the web and cite it.",
  weapon_rolls:
    "Goal: find the requested weapon, rank the player's copies with check_rolls, and propose equipping the best (plan kind weapon).",
  vault_cleanup:
    "Goal: find vault items that are clearly worse than a copy the player already has (duplicates, wishlist trash rolls, low stat armor) and propose tagging them as junk (plan kind cleanup). Never include locked or masterworked items.",
  postmaster_to_vault:
    "Goal: propose moving every postmaster item to the vault (plan kind postmaster, action to_vault).",
}

// The Agent SDK runs Claude Code headless and authenticates with the Claude
// login already on this machine, which is what lets the Claude subscription
// pay for the run instead of an API key. It gets the ghost MCP tools plus web
// search and fetch for current meta: no file system, no shell.
export const ClaudeAgentLive = Layer.effect(
  ClaudeAgent,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const mcpUrl = `http://127.0.0.1:${config.port}${MCP_PATH}`

    const run = (kind: JobKind, prompt: string, characterId: string | null) =>
      Effect.tryPromise({
        try: async () => {
          const selected =
            characterId === null
              ? "No character is selected; default to the highest light one."
              : `The player has character ${characterId} selected in the app; plans target it unless they say otherwise.`
          const fullPrompt = [KIND_PROMPTS[kind], selected, prompt]
            .filter((part) => part !== "")
            .join("\n\n")
          let lastText = ""
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              model: config.model,
              systemPrompt: SYSTEM_PROMPT,
              mcpServers: { ghost: { type: "http", url: mcpUrl } },
              tools: ["WebSearch", "WebFetch"],
              allowedTools: ["mcp__ghost__*", "WebSearch", "WebFetch"],
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
              maxTurns: 40,
            },
          })) {
            if (message.type === "assistant") {
              for (const block of message.message.content) {
                if (block.type === "text") lastText = block.text
              }
            }
            if (message.type === "result") {
              if (message.subtype === "success") return message.result || lastText
              throw new Error(`agent ended with ${message.subtype}`)
            }
          }
          return lastText
        },
        catch: (error) => new AgentFailed({ message: String(error) }),
      })

    return { run }
  }),
)
