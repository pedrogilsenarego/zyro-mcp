import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { AdminApi, type AdminCreateListingInput } from "./api.js";
import type { ListingsApi } from "../listings/api.js";
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
}
