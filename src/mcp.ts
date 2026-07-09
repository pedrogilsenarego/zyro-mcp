import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendClient } from "./backend/client.js";
import type { ToolDeps } from "./modules/deps.js";
import { ListingsApi } from "./modules/listings/api.js";
import { registerListingTools } from "./modules/listings/tools.js";

/**
 * Composition root: builds an MCP server for a single request and registers
 * each domain module's tools. `deps` carries the caller's identity, resolved
 * from the validated OAuth token — never from tool arguments.
 */
export function createMcpServer(
  client: BackendClient,
  deps: ToolDeps,
): McpServer {
  const server = new McpServer(
    { name: "zyro-mcp", version: "0.0.1" },
    {
      instructions:
        "You act inside a user's Zyr-o / imocerto account, scoped by their auth " +
        "token. Never ask for or accept a user id. Plan limits and email " +
        "verification are enforced by the backend — relay any error to the user.",
    },
  );

  registerListingTools(server, new ListingsApi(client), deps);

  return server;
}
