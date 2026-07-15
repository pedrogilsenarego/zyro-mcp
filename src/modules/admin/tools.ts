import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { AdminApi, type AdminCreateListingInput } from "./api.js";
import type { ListingsApi } from "../listings/api.js";
import { buildUpdateInput } from "../properties/tools.js";
import {
  HOUSE_FEATURE_KEYS,
  PROPERTY_TYPES,
  ROOM_FEATURE_KEYS,
} from "../../generated/contracts.js";

const SUPPORTED_BUSINESS_TYPES = ["roomRent"] as const;

// Registered ONLY for admin callers (see createMcpServer) — non-admins never
// see these tools. The backend still enforces admin, so a stale registration
// degrades to a relayed 403 rather than a data leak.
export function registerAdminTools(
  server: McpServer,
  api: AdminApi,
  listingsApi: ListingsApi,
  deps: ToolDeps,
): void {
  server.tool(
    "admin_list_user_listings",
    "ADMIN ONLY. List every listing belonging to a given user across ALL " +
      "statuses — including draft and inactive ones that the public directory " +
      "hides. Use this when an admin asks about another user's full listing " +
      "inventory. Pass the user's id (resolve a name/email to an id with " +
      "find_users first). Each row: { id, title, status, listingType, " +
      "ownerName, ownerEmail, portfolioTitle, unitTitle, createdAt }. Returns " +
      "the matched rows plus the total count.",
    {
      userId: z
        .string()
        .min(1)
        .describe("The target user's id (from find_users)."),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Max listings to return (default 50)."),
    },
    {
      title: "Admin: list a user's listings",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ userId, limit }: { userId: string; limit?: number }, { token }) => {
        const result = await api.listUserListings(userId, limit ?? 50, token);
        if (!result.ok) {
          return errorText(
            `Could not list the user's listings (status ${result.status}): ${result.body}`,
          );
        }
        return text(
          `${result.listings.length} of ${result.total} listing(s):\n${JSON.stringify(
            result.listings,
            null,
            2,
          )}`,
        );
      },
    ),
  );

  server.tool(
    "admin_get_listing",
    "ADMIN ONLY. Fetch the full detail of ANY listing by id — including ones " +
      "owned by another user — the same curated shape get_listing returns " +
      "(description, amenities, availableFrom / availableTo, deposit, gender, " +
      "maxPersons, match-alert state, and the listing's own location: latitude / " +
      "longitude / locationNormalizedName). Use this when an admin needs the full " +
      "detail of a listing they don't own — e.g. from an admin_list_user_listings " +
      "row. Get the id from a listing lookup; never guess it.",
    {
      listingId: z.string().min(1).describe("The listing's id (UUID)."),
    },
    {
      title: "Admin: get any listing's detail",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ listingId }: { listingId: string }, { token }) => {
        const result = await listingsApi.getListing(listingId, token);
        return result.ok
          ? text(JSON.stringify(result.listing, null, 2))
          : errorText(
              `Could not fetch listing (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );

  server.tool(
    "admin_list_user_properties",
    "ADMIN ONLY. List a given user's properties (houses/portfolios) with their " +
      "id, title, coordinates and market value. Use this to find a property's " +
      "id and to check whether it has a location set — `hasLocation` is false " +
      "when the property has no map coordinates, which is why its Location card " +
      "and map don't render. Pass the user's id (resolve a name/email with " +
      "find_users first). Pair with admin_update_property to fix a missing " +
      "location or value.",
    {
      userId: z
        .string()
        .min(1)
        .describe("The target user's id (from find_users)."),
    },
    {
      title: "Admin: list a user's properties",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(deps, async ({ userId }: { userId: string }, { token }) => {
      const result = await api.listUserProperties(userId, token);
      if (!result.ok) {
        return errorText(
          `Could not list the user's properties (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.properties.length} propert${
          result.properties.length === 1 ? "y" : "ies"
        }:\n${JSON.stringify(result.properties, null, 2)}`,
      );
    }),
  );

  server.tool(
    "admin_create_listing",
    "ADMIN ONLY. Create a room-rental listing ON BEHALF OF another user — the " +
      "listing is owned by that user, not by you. Use this when an admin asks " +
      "to set up a listing for someone (e.g. building it from a listing the " +
      "admin found on another website). Resolve the target person to an id with " +
      "find_users first and pass it as `userId`.\n\n" +
      "Only ROOM RENTALS are supported (businessType 'roomRent', a 'supply' " +
      "listing offering a room). Pass a `location` place name — it is geocoded " +
      "so the listing appears on the map. Optionally pass `images` as an array " +
      "of PUBLIC image URLs (e.g. the photos from the source listing page); the " +
      "server downloads each and attaches it. This does NOT work for images " +
      "pasted into the chat — only fetchable URLs. The listing is created " +
      "unpublished; publish it separately once the owner confirms it.",
    {
      userId: z
        .string()
        .min(1)
        .describe(
          "The target owner's id (from find_users). The listing is created " +
            "owned by this user, not by you.",
        ),
      title: z.string().min(1),
      rentPrice: z.number().positive().describe("Monthly rent in EUR."),
      propertyType: z
        .enum(PROPERTY_TYPES)
        .describe("The property the rented room is in."),
      businessType: z
        .enum(SUPPORTED_BUSINESS_TYPES)
        .describe("Only room rental is supported here."),
      location: z
        .string()
        .min(1)
        .describe(
          "Place name where the room is, e.g. 'Cascais, Portugal'. Geocoded so " +
            "the listing shows on the map. Use a specific town + country.",
        ),
      description: z
        .string()
        .optional()
        .describe("Free-text listing description."),
      availableFrom: z
        .string()
        .optional()
        .describe("ISO date the listing becomes available, e.g. '2026-07-17'."),
      roomFeatures: z
        .array(z.enum(ROOM_FEATURE_KEYS))
        .optional()
        .describe(`Room amenities. Allowed keys: ${ROOM_FEATURE_KEYS.join(", ")}.`),
      houseFeatures: z
        .array(z.enum(HOUSE_FEATURE_KEYS))
        .optional()
        .describe(
          `Shared-house amenities. Allowed keys: ${HOUSE_FEATURE_KEYS.join(", ")}.`,
        ),
      smokingAllowed: z.boolean().optional(),
      deposit: z.number().positive().optional().describe("Security deposit in EUR."),
      bedrooms: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of bedrooms in the property the room is in."),
      bathrooms: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of bathrooms in the property the room is in."),
      images: z
        .array(z.string().url())
        .max(20)
        .optional()
        .describe(
          "Public image URLs to attach (max 20). The server downloads each and " +
            "uploads it — use for photos scraped from a listing page. NOT for " +
            "images pasted into the chat.",
        ),
    },
    {
      title: "Admin: create listing for a user",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      // Fetches arbitrary external image URLs, so it reaches outside the app.
      openWorldHint: true,
    },
    authedHandler(
      deps,
      async (
        {
          userId,
          location,
          description,
          images,
          ...base
        }: {
          userId: string;
          location: string;
          description?: string;
          images?: string[];
        } & Omit<AdminCreateListingInput, "latitude" | "longitude" | "listingType">,
        { token },
      ) => {
        const geo = await listingsApi.geocode(location, token);
        if (!geo) {
          return errorText(
            `Could not find a location for "${location}". Try a more specific place name (town + country).`,
          );
        }
        const input: AdminCreateListingInput = {
          ...base,
          description,
          listingType: "supply",
          latitude: geo.lat,
          longitude: geo.lon,
        };
        const result = await api.createListingForUser(
          userId,
          input,
          images ?? [],
          token,
        );
        if (!result.ok) {
          return errorText(
            `Admin listing creation failed (status ${result.status}): ${result.body}`,
          );
        }
        const imageNote =
          (images?.length ?? 0) > 0
            ? ` ${result.imagesAttached} image(s) attached` +
              (result.imagesFailed.length
                ? `; couldn't fetch: ${result.imagesFailed.join(", ")}.`
                : ".")
            : "";
        return text(
          `Listing created for user ${userId}.${imageNote}\n${result.body}`,
        );
      },
    ),
  );

  server.tool(
    "admin_update_property",
    "ADMIN ONLY. Update a property (house/portfolio) OWNED BY another user, by " +
      "property id — the backend resolves the owner from the id, so no user id " +
      "is needed. Use this when an admin needs to fix another user's property, " +
      "e.g. setting its location so the map/Location card appears, or its market " +
      "value. Get the property id from admin listing/portfolio lookups. Only the " +
      "fields you pass change.\n\n" +
      "Pass `location` (a place name) to set the map position — it is geocoded. " +
      "Pass `marketValue` (EUR) for the portfolio-value card. houseFeatures " +
      "REPLACES the whole array. Relay any backend permission error verbatim.",
    {
      propertyId: z.string().min(1).describe("The property's id (UUID)."),
      title: z.string().min(1).optional(),
      location: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Place name of the property, e.g. 'Avenidas Novas, Lisboa, Portugal'. " +
            "Geocoded so the property's map/Location card appears.",
        ),
      marketValue: z
        .number()
        .nonnegative()
        .nullable()
        .optional()
        .describe("Estimated market value in EUR. Pass null to clear."),
      bedrooms: z.number().int().nonnegative().nullable().optional(),
      bathrooms: z.number().int().nonnegative().nullable().optional(),
      houseFeatures: z
        .array(z.enum(HOUSE_FEATURE_KEYS))
        .optional()
        .describe(
          `Shared-house amenities (replaces the whole array). Allowed keys: ${HOUSE_FEATURE_KEYS.join(", ")}.`,
        ),
    },
    {
      title: "Admin: update a user's property",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      // Geocoding hits an external service when `location` is passed.
      openWorldHint: true,
    },
    authedHandler(
      deps,
      async (
        {
          propertyId,
          location,
          ...rest
        }: {
          propertyId: string;
          location?: string;
          title?: string;
          marketValue?: number | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          houseFeatures?: (typeof HOUSE_FEATURE_KEYS)[number][];
        },
        { token },
      ) => {
        const input = await buildUpdateInput(rest, location, listingsApi, token);
        if ("error" in input) return errorText(input.error);
        if (Object.keys(input.value).length === 0) {
          return errorText(
            "Nothing to update — pass at least one field (e.g. location or marketValue).",
          );
        }
        const result = await api.updatePropertyForUser(
          propertyId,
          input.value,
          token,
        );
        return result.ok
          ? text(`Property ${propertyId} updated.\n${result.body}`)
          : errorText(
              `Admin property update failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );
}
