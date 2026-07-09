import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { ListingsApi, type CreateListingInput } from "./api.js";

export function registerListingTools(
  server: McpServer,
  api: ListingsApi,
  deps: ToolDeps,
): void {
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
      const token = deps.getAccessToken();
      if (!token) {
        return {
          isError: true,
          content: [{ type: "text", text: "Not authenticated." }],
        };
      }

      const result = await api.createListing(args as CreateListingInput, token);
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

  server.tool(
    "list_listings",
    "List the authenticated user's own (and shared-with) listings, including " +
      "drafts and inactive ones. Returns a curated summary per listing (id, " +
      "reference, title, status, type, price). Use the returned id for " +
      "get_listing / update_listing / delete_listing.",
    {},
    async () => {
      const token = deps.getAccessToken();
      const userId = deps.getUserId();
      if (!token || !userId) {
        return {
          isError: true,
          content: [{ type: "text", text: "Not authenticated." }],
        };
      }

      const result = await api.listMyListings(userId, token);
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not fetch listings (status ${result.status}): ${result.body}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${result.listings.length} listing(s):\n${JSON.stringify(
              result.listings,
              null,
              2,
            )}`,
          },
        ],
      };
    },
  );

  server.tool(
    "delete_listing",
    "Delete one of the authenticated user's listings by id. The id comes from a " +
      "prior create_listing result or a listing lookup — never guess it.",
    {
      listingId: z.string().min(1).describe("The listing's id (UUID)."),
    },
    async (args) => {
      const token = deps.getAccessToken();
      if (!token) {
        return {
          isError: true,
          content: [{ type: "text", text: "Not authenticated." }],
        };
      }

      const result = await api.deleteListing(args.listingId, token);
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Listing deletion failed (status ${result.status}): ${result.body}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: `Listing ${args.listingId} deleted.` }],
      };
    },
  );
}
