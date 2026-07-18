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
  PUBLISH_STATUSES,
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

export const propertyUrlField = z
  .string()
  .url()
  .describe(
    "Canonical/source URL of this listing on an external site (e.g. the " +
      "original room page it was imported from). Stored as the listing's " +
      "propertyUrl.",
  );

export const referenceField = z
  .string()
  .min(1)
  .describe(
    "The listing's reference. For an imported listing pass the source id (e.g. " +
      "the site's room code) — it's stored directly as the reference, like the " +
      "feed importers do. Omit to get an auto-generated 'IMO-…' reference.",
  );

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
      propertyUrl: propertyUrlField.optional(),
      reference: referenceField.optional(),
      roomFeatures: roomFeaturesField,
      houseFeatures: houseFeaturesField,
      smokingAllowed: z.boolean().optional(),
      deposit: z.number().positive().optional().describe("Security deposit in EUR."),
      bedrooms: bedroomsField.optional(),
      bathrooms: bathroomsField.optional(),
    },
    {
      title: "Create listing",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
      "get_listing (full detail), update_listing or set_listing_status. This " +
      "summary omits amenities and availability — call get_listing before " +
      "editing roomFeatures/houseFeatures or before activating.",
    {},
    {
      title: "List listings",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(deps, async (_args, { token, userId }) => {
      if (!userId) return errorText("Not authenticated.");
      const result = await api.listListingsByUser(userId, token);
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
    "list_user_listings",
    "List another user's PUBLIC listings by their user id (resolve a name/" +
      "email to an id with find_users first). Returns only their publicly " +
      "active listings — the same ones visible in the marketplace — as a " +
      "curated summary per listing (id, reference, title, status, type, " +
      "price). It never exposes drafts, inactive listings, or any personal " +
      "account data; that fuller view is admin-only. To list your OWN listings " +
      "(including drafts), use list_listings instead.",
    {
      userId: z
        .string()
        .min(1)
        .describe("The target user's id (from find_users)."),
    },
    {
      title: "List a user's public listings",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(deps, async ({ userId }: { userId: string }, { token }) => {
      const result = await api.listListingsByUser(userId, token);
      if (!result.ok) {
        return errorText(
          `Could not fetch the user's listings (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.listings.length} public listing(s):\n${JSON.stringify(
          result.listings,
          null,
          2,
        )}`,
      );
    }),
  );

  server.tool(
    "get_listing",
    "Fetch the full detail of one of the authenticated user's listings by id, " +
      "including fields list_listings omits: description, amenities " +
      "(roomFeatures / houseFeatures), availableFrom / availableTo, deposit, " +
      "gender, maxPersons, match-alert state, and the listing's own location " +
      "(latitude / longitude / locationNormalizedName — a listing has its own " +
      "coordinates, independent of any associated property). The id comes from a prior " +
      "list_listings / create_listing result — never guess it.\n\n" +
      "Call this BEFORE any relative edit. roomFeatures / houseFeatures are " +
      "whole-array fields — update_listing replaces the entire array, so to " +
      "add or remove one amenity you must read the current list here first and " +
      "send the full intended array, or you will silently drop the others. " +
      "Also use it to read the current price and availableFrom before " +
      "activating a listing with set_listing_status.",
    {
      listingId: z.string().min(1).describe("The listing's id (UUID)."),
    },
    {
      title: "Get listing detail",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ listingId }: { listingId: string }, { token }) => {
        const result = await api.getListing(listingId, token);
        return result.ok
          ? text(JSON.stringify(result.listing, null, 2))
          : errorText(
              `Could not fetch listing (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );

  server.tool(
    "update_listing",
    "Update fields on one of the authenticated user's listings by id. Only the " +
      "fields you pass are changed; omit the rest. The id comes from a prior " +
      "list_listings / create_listing result — never guess it. roomFeatures and " +
      "houseFeatures REPLACE the whole array — read the current values with " +
      "get_listing first so a partial change doesn't drop existing amenities.",
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
      reference: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The listing's reference/code from its original source (agency feed, portal, etc.).",
        ),
      propertyUrl: z
        .string()
        .url()
        .nullable()
        .optional()
        .describe(
          "URL of the original listing on its source site. Pass null to clear.",
        ),
      latitude: z
        .number()
        .optional()
        .describe(
          "New map latitude. Pass together with longitude — the backend " +
            "reverse-resolves the parish/normalized name from the coords. Use " +
            "to correct a listing's location or sync it onto its property's " +
            "coordinates (read those from admin_list_user_properties).",
        ),
      longitude: z
        .number()
        .optional()
        .describe("New map longitude. Must be sent together with latitude."),
    },
    {
      title: "Update listing",
      readOnlyHint: false,
      // Overwrites fields (incl. replacing whole arrays) but never removes the
      // listing; re-sending the same payload yields the same state.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async (
        { listingId, ...input }: { listingId: string } & UpdateListingInput,
        { token },
      ) => {
        if ((input.latitude == null) !== (input.longitude == null)) {
          return errorText(
            "Pass latitude and longitude together — the backend needs both to set a location.",
          );
        }
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
    "set_listing_status",
    "Set the publish status of one of the authenticated user's listings by id. " +
      "'active' = publicly visible to renters and matched against demand; " +
      "'inactive' and 'draft' = hidden from the public. The id comes from a " +
      "prior list_listings / create_listing result — " +
      "never guess it.\n\n" +
      "Before setting a listing to 'active', first confirm its current price and " +
      "availability date with the user: read them via list_listings, state them " +
      "back (e.g. \"This will publish at EUR X/month, available from <date> — " +
      "correct?\"), and offer to fix them with update_listing before publishing. " +
      "This mirrors the review step the app shows when a listing goes live. Note " +
      "that active room rentals auto-deactivate after ~2 months without an " +
      "update. Relay any plan-limit or email-verification errors from the " +
      "backend verbatim.",
    {
      listingId: z.string().min(1).describe("The listing's id (UUID)."),
      status: z
        .enum(PUBLISH_STATUSES)
        .describe(
          "New publish status. 'active' publishes it publicly; 'inactive'/'draft' hide it.",
        ),
    },
    {
      title: "Set listing status",
      readOnlyHint: false,
      // Not destructive to stored data, but it is outward-facing and
      // consequential: 'active' makes the listing publicly visible and fires
      // match notifications. Flagged destructive so clients confirm first.
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async (
        { listingId, status }: { listingId: string; status: string },
        { token },
      ) => {
        const result = await api.setPublishStatus(listingId, status, token);
        return result.ok
          ? text(`Listing ${listingId} is now ${status}.\n${result.body}`)
          : errorText(
              `Status change failed (status ${result.status}): ${result.body}`,
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
    {
      title: "Delete listing",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
