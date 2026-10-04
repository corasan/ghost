import { Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { GhostToolkit, GhostToolkitHandlers } from "./tools.ts"

export const MCP_PATH = "/mcp"

// The MCP server is mounted on the same Bun HTTP server as the REST API, so
// there is exactly one process and one port. The Claude Agent SDK connects to
// it over Streamable HTTP on loopback.
export const McpLive = Layer.mergeAll(
  McpServer.layerHttp({
    name: "ghost",
    version: "0.0.0",
    path: MCP_PATH,
    instructions:
      "You operate a Destiny 2 account through the Bungie API. Call get_memberships first to learn membershipType and membershipId, then get_profile. After moving items, call record_seen_items.",
    protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
  }),
  McpServer.toolkit(GhostToolkit).pipe(Layer.provide(GhostToolkitHandlers)),
)
