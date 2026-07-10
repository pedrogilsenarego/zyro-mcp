import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import {
  ListingsApi,
  type CreateListingInput,
  type UpdateListingInput,
} from "./api.js";

// The backend supports more business types (sale, rent, auction), but the app UI
// currently only lets users create room rentals. This tool mirrors that product
// surface — widen this list (and propertyType/listingType) when the UI ships the
// others; no backend change is needed for that.
const SUPPORTED_BUSINESS_TYPES = ["roomRent"] as const;

export function registerListingTools(
  server: McpServer,
  api: ListingsApi,
  deps: ToolDeps,
): void {
  server.tool(
    "create_listing",
    "Create a room-rental listing in Zyr-o / imocerto as the authenticated user. " +
      "This tool currently only creates ROOM RENTALS, mirroring the app UI: a " +
      "listing either offers a room to rent (listingType 'supply') or seeks one " +
      "('demand'). Selling or renting out a whole house/apartment is not yet " +
      "exposed here — if the user asks for that, tell them only room-rental " +
      "listings can be created for now instead of guessing a businessType.",
    {
      title: z.string().min(1),
      rentPrice: z.number().positive().describe("Monthly rent in EUR."),
      propertyType: z
        .enum(["room", "apartment", "house"])
        .describe("The property the rented room is in."),
      businessType: z
        .enum(SUPPORTED_BUSINESS_TYPES)
        .describe(
          "Only room rental is exposed for now. Whole-property sale or rent is " +
            "not yet available via this tool — do not pass 'sale', 'rent' or 'buy'.",
        ),
      listingType: z
        .enum(["supply", "demand"])
        .optional()
        .describe(
          "'supply' = offering a room to rent; 'demand' = looking for a room to rent.",
        ),
      availableFrom: z
        .string()
        .optional()
        .describe("ISO date the listing becomes available, e.g. '2026-07-17'."),
      roomFeatures: z
        .array(z.string())
        .optional()
        .describe("Room amenities, e.g. ['desk', 'wifi']."),
      smokingAllowed: z.boolean().optional(),
      deposit: z.number().positive().optional().describe("Security deposit in EUR."),
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
      "update_listing / delete_listing.",
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
    "update_listing",
    "Update fields on one of the authenticated user's listings by id. Only the " +
      "fields you pass are changed; omit the rest. The id comes from a prior " +
      "list_listings / create_listing result — never guess it.",
    {
      listingId: z.string().min(1).describe("The listing's id (UUID)."),
      title: z.string().min(1).optional(),
      rentPrice: z.number().positive().optional().describe("Monthly rent in EUR."),
      salePrice: z.number().positive().optional().describe("Sale price in EUR."),
      availableFrom: z
        .string()
        .nullable()
        .optional()
        .describe("ISO date, e.g. '2026-07-17'. Pass null to clear."),
      roomFeatures: z
        .array(z.string())
        .optional()
        .describe("Replaces the current room amenities, e.g. ['desk', 'wifi']."),
      smokingAllowed: z.boolean().optional(),
      deposit: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Security deposit in EUR. Pass null to clear."),
    },
    authedHandler(
      deps,
      async (
        { listingId, ...input }: { listingId: string } & UpdateListingInput,
        { token },
      ) => {
        const result = await api.updateListing(listingId, input, token);
        return result.ok
          ? text(`Listing ${listingId} updated.\n${result.body}`)
          : errorText(
              `Listing update failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
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
