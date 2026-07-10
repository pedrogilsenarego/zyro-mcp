import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import {
  ListingsApi,
  type CreateListingArgs,
  type CreateListingInput,
  type UpdateListingInput,
} from "./api.js";
import {
  HOUSE_FEATURE_KEYS,
  LISTING_TYPES,
  PROPERTY_TYPES,
  ROOM_FEATURE_KEYS,
} from "../../generated/contracts.js";

const SUPPORTED_BUSINESS_TYPES = ["roomRent"] as const;

const roomFeaturesField = z
  .array(z.enum(ROOM_FEATURE_KEYS))
  .optional()
  .describe(`Room amenities. Allowed keys: ${ROOM_FEATURE_KEYS.join(", ")}.`);

const houseFeaturesField = z
  .array(z.enum(HOUSE_FEATURE_KEYS))
  .optional()
  .describe(
    `Shared-house amenities. Allowed keys: ${HOUSE_FEATURE_KEYS.join(", ")}.`,
  );

const bedroomsField = z
  .number()
  .int()
  .nonnegative()
  .describe("Number of bedrooms in the property the room is in.");

const bathroomsField = z
  .number()
  .int()
  .nonnegative()
  .describe("Number of bathrooms in the property the room is in.");

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
        .enum(PROPERTY_TYPES)
        .describe("The property the rented room is in."),
      businessType: z
        .enum(SUPPORTED_BUSINESS_TYPES)
        .describe(
          "Only room rental is exposed for now. Whole-property sale or rent is " +
            "not yet available via this tool — do not pass 'sale', 'rent' or 'buy'.",
        ),
      listingType: z
        .enum(LISTING_TYPES)
        .optional()
        .describe(
          "'supply' = offering a room to rent; 'demand' = looking for a room to rent.",
        ),
      location: z
        .string()
        .optional()
        .describe(
          "Place name where the room is, e.g. 'Cascais, Portugal'. Required for " +
            "'supply' listings — it is geocoded so the listing appears on the map " +
            "and in location searches. Use a specific town + country.",
        ),
      availableFrom: z
        .string()
        .optional()
        .describe("ISO date the listing becomes available, e.g. '2026-07-17'."),
      roomFeatures: roomFeaturesField,
      houseFeatures: houseFeaturesField,
      smokingAllowed: z.boolean().optional(),
      deposit: z.number().positive().optional().describe("Security deposit in EUR."),
      bedrooms: bedroomsField.optional(),
      bathrooms: bathroomsField.optional(),
    },
    authedHandler(
      deps,
      async ({ location, ...base }: CreateListingArgs, { token }) => {
        if ((base.listingType ?? "supply") === "demand") {
          return errorText(
            "Demand listings can't be created here yet — they're located by area codes, not a place name.",
          );
        }
        if (!location) {
          return errorText(
            "A location is required for supply listings. Pass `location`, e.g. 'Cascais, Portugal'.",
          );
        }
        const geo = await api.geocode(location, token);
        if (!geo) {
          return errorText(
            `Could not find a location for "${location}". Try a more specific place name (town + country).`,
          );
        }
        const input: CreateListingInput = {
          ...base,
          listingType: "supply",
          latitude: geo.lat,
          longitude: geo.lon,
        };
        const result = await api.createListing(input, token);
        return result.ok
          ? text(`Listing created.\n${result.body}`)
          : errorText(
              `Listing creation failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
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
      roomFeatures: roomFeaturesField,
      houseFeatures: houseFeaturesField,
      smokingAllowed: z.boolean().optional(),
      deposit: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Security deposit in EUR. Pass null to clear."),
      bedrooms: bedroomsField.nullable().optional(),
      bathrooms: bathroomsField.nullable().optional(),
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
