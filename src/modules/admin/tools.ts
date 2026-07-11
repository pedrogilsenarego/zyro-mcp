import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { AdminApi } from "./api.js";

// Registered ONLY for admin callers (see createMcpServer) — non-admins never
// see this tool. The backend still enforces admin, so a stale registration
// degrades to a relayed 403 rather than a data leak.
export function registerAdminTools(
  server: McpServer,
  api: AdminApi,
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
}
