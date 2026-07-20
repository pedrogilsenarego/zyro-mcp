import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { SearchApi, type SearchBusinessType } from "./api.js";

export function registerSearchTools(
  server: McpServer,
  api: SearchApi,
  deps: ToolDeps,
): void {
  server.tool(
    "search_listings",
    "Search the PUBLIC marketplace directory — the same search the website uses " +
      "— across ALL owners, not just your own listings. Use this for questions " +
      "like 'last added rooms in Lisbon' or 'rooms for rent in Porto'. Returns a " +
      "curated summary per result (id, title, price, location, house, createdAt), " +
      "the total match count, and the backend response time in ms.\n\n" +
      "`location` matches the place's local (Portuguese) administrative name, so " +
      "use 'lisboa' not 'Lisbon', 'porto' not 'Oporto'. For 'last added' pass " +
      "sort='newest'. Only publicly active supply listings are returned.",
    {
      businessType: z
        .enum(["room", "buy", "rent", "auction"])
        .optional()
        .describe(
          "What to search for. 'room' = room rentals (default), 'buy' = " +
            "properties for sale, 'rent' = whole-property rentals, 'auction' = " +
            "auctions.",
        ),
      location: z
        .string()
        .optional()
        .describe(
          "Local (Portuguese) place name to filter by, e.g. 'lisboa', 'porto', " +
            "'cascais'. Matches the administrative area name exactly (lowercased).",
        ),
      sort: z
        .enum(["newest", "oldest", "priceAsc", "priceDesc"])
        .optional()
        .describe("Result ordering. 'newest' = most recently added first."),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Max results to return (default 20)."),
    },
    {
      title: "Search public listings",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async (
        {
          businessType,
          location,
          sort,
          limit,
        }: {
          businessType?: "room" | "buy" | "rent" | "auction";
          location?: string;
          sort?: "newest" | "oldest" | "priceAsc" | "priceDesc";
          limit?: number;
        },
        { token },
      ) => {
        const businessTypeMap: Record<string, SearchBusinessType> = {
          room: "roomRent",
          buy: "sale",
          rent: "rent",
          auction: "auction",
        };
        const resolvedBusinessType = businessTypeMap[businessType ?? "room"];
        const sortMap: Record<
          string,
          { sortBy: string; sortDir: "asc" | "desc" }
        > = {
          newest: { sortBy: "createdAt", sortDir: "desc" },
          oldest: { sortBy: "createdAt", sortDir: "asc" },
          priceDesc: {
            sortBy: resolvedBusinessType === "sale" ? "salePrice" : "rentPrice",
            sortDir: "desc",
          },
          priceAsc: {
            sortBy: resolvedBusinessType === "sale" ? "salePrice" : "rentPrice",
            sortDir: "asc",
          },
        };
        const sortOpt = sort ? sortMap[sort] : undefined;

        const result = await api.searchPublicListings(
          {
            businessType: resolvedBusinessType,
            locationName: location?.trim().toLowerCase() || undefined,
            limit,
            sortBy: sortOpt?.sortBy,
            sortDir: sortOpt?.sortDir,
          },
          token,
        );
        if (!result.ok) {
          return errorText(
            `Search failed (status ${result.status}, ${result.ms}ms): ${result.body}`,
          );
        }
        const header =
          `${result.total} match(es)` +
          (resolvedBusinessType === "roomRent"
            ? ` (${result.totalListings} room(s) across those houses)`
            : "") +
          `, showing ${result.listings.length} — backend ${result.ms}ms:`;
        return text(`${header}\n${JSON.stringify(result.listings, null, 2)}`);
      },
    ),
  );
}
