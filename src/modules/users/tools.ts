import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { UsersApi } from "./api.js";

export function registerUserTools(
  server: McpServer,
  api: UsersApi,
  deps: ToolDeps,
): void {
  server.tool(
    "find_users",
    "Search people on the platform by name or email — use this to resolve a " +
      "person the user names (e.g. to share a property with, or add as a " +
      "collaborator) into their user id. Returns a minimal identity for each " +
      "match: { id, name, email }. The caller is excluded from results. This " +
      "is a directory lookup, not account administration — it never returns " +
      "roles, plans or private account data.",
    {
      query: z
        .string()
        .min(1)
        .describe("Name or email fragment to match (case-insensitive)."),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe("Max matches to return (default 20)."),
    },
    {
      title: "Find users",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ query, limit }: { query: string; limit?: number }, { token }) => {
        const result = await api.findUsers(query, limit ?? 20, token);
        if (!result.ok) {
          return errorText(
            `Could not search users (status ${result.status}): ${result.body}`,
          );
        }
        return text(
          `${result.users.length} user(s):\n${JSON.stringify(
            result.users,
            null,
            2,
          )}`,
        );
      },
    ),
  );
}
