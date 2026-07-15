import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { PropertiesApi, type UpdatePropertyInput } from "./api.js";
import type { ListingsApi } from "../listings/api.js";
import { HOUSE_FEATURE_KEYS } from "../../generated/contracts.js";

export function registerPropertyTools(
  server: McpServer,
  api: PropertiesApi,
  listingsApi: ListingsApi,
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

  server.tool(
    "update_property",
    "Update fields on one of the authenticated user's properties (a house/" +
      "portfolio, not a listing) by id. Only the fields you pass change; omit " +
      "the rest. The id comes from a prior list_properties result — never guess " +
      "it.\n\n" +
      "Pass `location` (a place name) to set where the property sits on the map " +
      "— it is geocoded, which is what makes the property's Location card and " +
      "map appear. Pass `marketValue` (EUR) to populate the portfolio-value " +
      "card. houseFeatures REPLACES the whole array.",
    {
      propertyId: z.string().min(1).describe("The property's id (UUID)."),
      title: z.string().min(1).optional(),
      location: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Place name of the property, e.g. 'Avenidas Novas, Lisboa, Portugal'. " +
            "Geocoded so the property's map/Location card appears. Use a " +
            "specific address or town + country.",
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
      title: "Update property",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      // Geocoding hits an external service when `location` is passed.
      openWorldHint: true,
    },
    authedHandler(
      deps,
      async (
        { propertyId, location, ...rest }: UpdatePropertyArgs,
        { token },
      ) => {
        const input = await buildUpdateInput(rest, location, listingsApi, token);
        if ("error" in input) return errorText(input.error);
        if (Object.keys(input.value).length === 0) {
          return errorText(
            "Nothing to update — pass at least one field (e.g. location or marketValue).",
          );
        }
        const result = await api.updateProperty(propertyId, input.value, token);
        return result.ok
          ? text(`Property ${propertyId} updated.\n${result.body}`)
          : errorText(
              `Property update failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );
}

type UpdatePropertyArgs = {
  propertyId: string;
  location?: string;
  title?: string;
  marketValue?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  houseFeatures?: UpdatePropertyInput["houseFeatures"];
};

// Shared by the user and admin update tools: geocodes `location` into
// latitude/longitude (the BE reverse-resolves the freguesia) and merges it with
// the other passed fields into the UpdatePropertyInput the endpoint expects.
export async function buildUpdateInput(
  fields: Omit<UpdatePropertyArgs, "propertyId" | "location">,
  location: string | undefined,
  listingsApi: ListingsApi,
  token: string,
): Promise<{ value: UpdatePropertyInput } | { error: string }> {
  const value: UpdatePropertyInput = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) (value as Record<string, unknown>)[key] = val;
  }
  if (location) {
    const geo = await listingsApi.geocode(location, token);
    if (!geo) {
      return {
        error: `Could not find a location for "${location}". Try a more specific place name (address or town + country).`,
      };
    }
    value.latitude = geo.lat;
    value.longitude = geo.lon;
  }
  return { value };
}
