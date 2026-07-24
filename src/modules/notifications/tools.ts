import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { NotificationsApi } from "./api.js";

export function registerNotificationTools(
  server: McpServer,
  api: NotificationsApi,
  deps: ToolDeps,
): void {
  server.tool(
    "list_notifications",
    "List the authenticated user's notifications, newest first. Each row has " +
      "notificationType (e.g. 'listing_match', 'al_check_in_submitted', " +
      "'listing_auto_deactivated', 'property_share_accepted'), title, message, " +
      "viewedAt/interactedAt/createdAt, and a raw data JSON string with extra " +
      "context. Only match/price-change notifications embed an image in " +
      "data.image; other types carry none.",
    {
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Max notifications to return (default 50, BE caps at 100)."),
    },
    { title: "List notifications", readOnlyHint: true, openWorldHint: false },
    authedHandler(deps, async ({ limit }: { limit?: number }, { token }) => {
      const result = await api.listNotifications(limit ?? 50, token);
      if (!result.ok) {
        return errorText(
          `Could not fetch notifications (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.notifications.length} notification(s):\n${JSON.stringify(
          result.notifications,
          null,
          2,
        )}`,
      );
    }),
  );
}
