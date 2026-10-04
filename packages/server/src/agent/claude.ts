import { query } from "@anthropic-ai/claude-agent-sdk"
import type { JobKind } from "@ghost/contract"
import { Context, Effect, Layer, Schema } from "effect"
import { AppConfig } from "../config.ts"
import { MCP_PATH } from "../mcp/server.ts"

export class AgentFailed extends Schema.TaggedError<AgentFailed>()("AgentFailed", {
  message: Schema.String,
}) {}

export interface ClaudeAgentShape {
  readonly run: (kind: JobKind, prompt: string) => Effect.Effect<string, AgentFailed>
}

export class ClaudeAgent extends Context.Service<ClaudeAgent, ClaudeAgentShape>()("ClaudeAgent") {}

const SYSTEM_PROMPT =
  "You are Ghost, a Destiny 2 companion. You act on the player's account through the ghost MCP tools only. Be concise. Before deleting or dismantling anything, list exactly what will be removed and why. Report what you did at the end."

const KIND_PROMPTS: Record<JobKind, string> = {
  chat: "",
  build_suggestion:
    "Goal: suggest the best build for the requested stats using gear the player already owns.",
  weapon_rolls:
    "Goal: find the requested weapon and rank the player's copies by roll quality, explaining the perks.",
  vault_cleanup:
    "Goal: find vault items that are clearly worse than a copy the player already has and list them for removal.",
  postmaster_to_vault:
    "Goal: move every item in each character's postmaster to the vault, then record the moved items with record_seen_items.",
}

// The Agent SDK runs Claude Code headless and authenticates with the Claude
// login already on this machine, which is what lets the Claude subscription
// pay for the run instead of an API key. The only tools it gets are the ghost
// MCP tools: no file system, no shell.
export const ClaudeAgentLive = Layer.effect(
  ClaudeAgent,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const mcpUrl = `http://127.0.0.1:${config.port}${MCP_PATH}`

    const run = (kind: JobKind, prompt: string) =>
      Effect.tryPromise({
        try: async () => {
          const framing = KIND_PROMPTS[kind]
          const fullPrompt = framing === "" ? prompt : `${framing}\n\n${prompt}`
          let lastText = ""
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              model: config.model,
              systemPrompt: SYSTEM_PROMPT,
              mcpServers: { ghost: { type: "http", url: mcpUrl } },
              tools: [],
              allowedTools: ["mcp__ghost__*"],
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
