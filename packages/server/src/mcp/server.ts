import { Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { MCP_PATH } from "./path.ts"
import { GhostToolkit, GhostToolkitHandlers } from "./tools.ts"

// The MCP server is mounted on the same Bun HTTP server as the REST API, so
// there is exactly one process and one port. The Claude Agent SDK connects to
// it over Streamable HTTP on loopback.
export const McpLive = Layer.mergeAll(
  McpServer.layerHttp({
    name: "ghost",
    version: "0.0.0",
    path: MCP_PATH,
    instructions:
      "Read-only view of a Destiny 2 account plus fetched reference data. get_characters and search_items read the account; check_rolls and roll_recommendations judge rolls against the DIM community wishlist; describe_plugs gives current perk and mod effects. Nothing here moves items: propose changes with present_plan, which the player confirms in the app. Record every source you rely on with cite_sources.",
    protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
  }),
  McpServer.toolkit(GhostToolkit).pipe(Layer.provide(GhostToolkitHandlers)),
)
