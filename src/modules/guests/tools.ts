import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { GuestsApi } from "./api.js";

export function registerGuestTools(
  server: McpServer,
  api: GuestsApi,
  deps: ToolDeps,
): void {
  server.tool(
    "list_guests",
    "List the authenticated user's guests with their occupancy status and " +
      "linked stays. Each guest has a status (active | future | past | none) " +
      "and an events[] list of stays ({ type, startDate, endDate, " +
      "propertyName, unitName }). Use this to answer occupancy questions — e.g. " +
      "the next guest to leave is the active event with the soonest future " +
      "endDate, and the room freeing up next is that event's unitName (its " +
      "property is propertyName). unitName is null for whole-property stays.",
    {},
    authedHandler(deps, async (_args, { token }) => {
      const result = await api.listGuests(token);
      if (!result.ok) {
        return errorText(
          `Could not fetch guests (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.guests.length} guest(s):\n${JSON.stringify(
          result.guests,
          null,
          2,
        )}`,
      );
    }),
  );
}
