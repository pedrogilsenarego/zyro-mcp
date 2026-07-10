import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
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
    authedHandler(deps, async (args: CreateListingInput, { token }) => {
      const result = await api.createListing(args, token);
      return result.ok
        ? text(`Listing created.\n${result.body}`)
        : errorText(
            `Listing creation failed (status ${result.status}): ${result.body}`,
          );
    }),
  );

  server.tool(
    "list_listings",
    "List the authenticated user's own (and shared-with) listings, including " +
      "drafts and inactive ones. Returns a curated summary per listing (id, " +
      "reference, title, status, type, price). Use the returned id for " +
      "get_listing / update_listing / delete_listing.",
    {},
    authedHandler(deps, async (_args, { token, userId }) => {
      if (!userId) return errorText("Not authenticated.");
      const result = await api.listMyListings(userId, token);
      if (!result.ok) {
        return errorText(
          `Could not fetch listings (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.listings.length} listing(s):\n${JSON.stringify(
          result.listings,
          null,
          2,
        )}`,
      );
    }),
  );

  server.tool(
    "delete_listing",
    "Delete one of the authenticated user's listings by id. The id comes from a " +
      "prior create_listing result or a listing lookup — never guess it.",
    {
      listingId: z.string().min(1).describe("The listing's id (UUID)."),
    },
    authedHandler(deps, async (args: { listingId: string }, { token }) => {
      const result = await api.deleteListing(args.listingId, token);
      return result.ok
        ? text(`Listing ${args.listingId} deleted.`)
        : errorText(
            `Listing deletion failed (status ${result.status}): ${result.body}`,
          );
    }),
  );
}
