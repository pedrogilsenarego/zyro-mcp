import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { PropertiesApi } from "./api.js";

export function registerPropertyTools(
  server: McpServer,
  api: PropertiesApi,
  deps: ToolDeps,
): void {
  server.tool(
    "list_properties",
    "List the authenticated user's properties and their rentable units " +
      "(rooms). Each property has { id, title, bedrooms, bathrooms, " +
      "generatesIncome, units[] } where each unit is { id, title, unitType }. " +
      "Use this for the full room inventory — including rooms with no current " +
      "guest. Cross-reference a property/unit with list_guests events to tell " +
      "which rooms are occupied vs. already empty.",
    {},
    authedHandler(deps, async (_args, { token }) => {
      const result = await api.listProperties(token);
      if (!result.ok) {
        return errorText(
          `Could not fetch properties (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.properties.length} propert${
          result.properties.length === 1 ? "y" : "ies"
        }:\n${JSON.stringify(result.properties, null, 2)}`,
      );
    }),
  );
}
