import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ImocertoApi, type CreateListingInput } from "./imocerto.js";

/**
 * Builds an MCP server for a single request. `getAccessToken` returns the
 * caller's imocerto JWT (resolved from the validated OAuth token). Identity is
 * never a tool argument.
 */
export function createMcpServer(
  api: ImocertoApi,
  getAccessToken: () => string | undefined,
): McpServer {
  const server = new McpServer(
    { name: "zyro-mcp", version: "0.0.1" },
    {
      instructions:
        "You act inside a user's Zyr-o / imocerto account, scoped by their auth " +
        "token. Never ask for or accept a user id. create_listing requires " +
        "title, rentPrice, propertyType and businessType; plan limits and email " +
        "verification are enforced by the backend — relay any error to the user.",
    },
  );

  server.tool(
    "create_listing",
    "Create a real-estate listing in Zyr-o / imocerto as the authenticated user.",
    {
      title: z.string().min(1),
      rentPrice: z.number().positive().describe("Monthly rent / price in EUR."),
      propertyType: z.string().describe("e.g. 'apartment', 'house', 'room'."),
      businessType: z.string().describe("e.g. 'roomRent' or 'buy'."),
      listingType: z.enum(["supply", "demand"]).optional(),
    },
    async (args) => {
      const token = getAccessToken();
      if (!token) {
        return {
          isError: true,
          content: [{ type: "text", text: "Not authenticated." }],
        };
      }

      const result = await api.createListing(
        args as CreateListingInput,
        token,
      );
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Listing creation failed (status ${result.status}): ${result.body}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: `Listing created.\n${result.body}` }],
      };
    },
  );

  return server;
}
