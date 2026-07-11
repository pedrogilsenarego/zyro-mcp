import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendClient } from "./backend/client.js";
import type { ToolDeps } from "./modules/deps.js";
import { ListingsApi } from "./modules/listings/api.js";
import { registerListingTools } from "./modules/listings/tools.js";
import { GuestsApi } from "./modules/guests/api.js";
import { registerGuestTools } from "./modules/guests/tools.js";
import { PropertiesApi } from "./modules/properties/api.js";
import { registerPropertyTools } from "./modules/properties/tools.js";
import { PaymentsApi } from "./modules/payments/api.js";
import { registerPaymentTools } from "./modules/payments/tools.js";
import { EventsApi } from "./modules/events/api.js";
import { registerEventTools } from "./modules/events/tools.js";
import { UsersApi } from "./modules/users/api.js";
import { registerUserTools } from "./modules/users/tools.js";

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
      instructions: [
        "You act inside a user's Zyr-o / imocerto account, scoped by their auth",
        "token. Never ask for or accept a user id — identity always comes from",
        "the token.",
        "",
        "Business rules are enforced by the backend, not here — when a call",
        "fails, relay the backend's error verbatim rather than guessing.",
        "",
        "A user sees both their own resources and ones shared with them, but can",
        "only modify what they own or were granted edit access to. A permission",
        "error on a write means they have view-only access — tell them that.",
      ].join("\n"),
    },
  );

  registerListingTools(server, new ListingsApi(client), deps);
  registerGuestTools(server, new GuestsApi(client), deps);
  registerPropertyTools(server, new PropertiesApi(client), deps);
  registerPaymentTools(server, new PaymentsApi(client), deps);
  registerEventTools(server, new EventsApi(client), deps);
  registerUserTools(server, new UsersApi(client), deps);

  return server;
}
