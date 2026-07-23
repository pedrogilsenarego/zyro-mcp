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
      propertyType: z
        .string()
        .optional()
        .describe(
          "realEstateType filter, e.g. '1' (apartment). Comma-separated allowed. " +
            "The FE applies this by default for buy — pass it to measure the real query.",
        ),
      typology: z
        .string()
        .optional()
        .describe(
          "Typology / bedroom count filter (buy & rent, not rooms). PT convention: " +
            "comma-separated exact values where the top value is open-ended, e.g. " +
            "'2' = T2 only, '1,3' = T1 or T3, '5' = T5+ (5 or more bedrooms).",
        ),
      availableFrom: z
        .enum(["now", "1m", "2m", "6m", "1y"])
        .optional()
        .describe(
          "Room availability horizon (roomRent only). The FE default room search " +
            "sends '1m'. Pass it to measure the real query.",
        ),
      sort: z
        .enum(["newest", "oldest", "updated", "priceAsc", "priceDesc"])
        .optional()
        .describe(
          "Result ordering. 'newest'/'oldest' = createdAt; 'updated' = updatedAt " +
            "desc (the FE default); 'priceAsc'/'priceDesc' = price.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Max results to return (default 20)."),
      runs: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Fire the identical query N times back-to-back (default 1) and report " +
            "each backend time. Use to tell a steady cost (consistent ms) from a " +
            "busy/cold server (erratic ms) or the 60s cache (later runs near 0).",
        ),
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
          propertyType,
          typology,
          availableFrom,
          sort,
          limit,
          runs,
        }: {
          businessType?: "room" | "buy" | "rent" | "auction";
          location?: string;
          propertyType?: string;
          typology?: string;
          availableFrom?: "now" | "1m" | "2m" | "6m" | "1y";
          sort?: "newest" | "oldest" | "updated" | "priceAsc" | "priceDesc";
          limit?: number;
          runs?: number;
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
          updated: { sortBy: "updatedAt", sortDir: "desc" },
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
        const params = {
          businessType: resolvedBusinessType,
          locationName: location?.trim().toLowerCase() || undefined,
          realEstateType: propertyType,
          bedroomsIn:
            resolvedBusinessType === "roomRent" ? undefined : typology,
          availableFrom:
            resolvedBusinessType === "roomRent" ? availableFrom : undefined,
          limit,
          sortBy: sortOpt?.sortBy,
          sortDir: sortOpt?.sortDir,
        };

        const n = runs ?? 1;
        const times: number[] = [];
        let last: Awaited<ReturnType<typeof api.searchPublicListings>> | null =
          null;
        for (let i = 0; i < n; i += 1) {
          last = await api.searchPublicListings(params, token);
          times.push(last.ms);
          if (!last.ok) {
            return errorText(
              `Search failed on run ${i + 1} (status ${last.status}, ${last.ms}ms): ${last.body}`,
            );
          }
        }
        // The loop returns early on any failure, so this is always a success.
        const result = last!;
        const timing =
          n === 1
            ? `backend ${times[0]}ms`
            : `backend runs ms=[${times.join(", ")}] (min ${Math.min(
                ...times,
              )}, max ${Math.max(...times)})`;
        const header =
          `${result.total} match(es)` +
          (resolvedBusinessType === "roomRent"
            ? ` (${result.totalListings} room(s) across those houses)`
            : "") +
          `, showing ${result.listings.length} — ${timing}:`;
        return text(`${header}\n${JSON.stringify(result.listings, null, 2)}`);
      },
    ),
  );
}
