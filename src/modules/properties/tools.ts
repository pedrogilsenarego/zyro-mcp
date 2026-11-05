import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import {
  PropertiesApi,
  type CreatePropertyInput,
  type UpdatePropertyInput,
  type ElectricityInput,
  type GasInput,
} from "./api.js";
import type { ListingsApi } from "../listings/api.js";
import {
  ELECTRICITY_TARIFF_OPTIONS,
  GAS_TIERS,
  HOUSE_FEATURE_KEYS,
} from "../../generated/contracts.js";

// Shared Zod shape for the create tools (user + admin), minus the owner id the
// admin variant adds. Kept here so both tools describe the fields identically.
export const CREATE_PROPERTY_FIELDS = {
  title: z
    .string()
    .min(1)
    .describe("The property/house name, e.g. 'Casa Passos Manuel'."),
  description: z
    .string()
    .optional()
    .describe(
      "Free-text description of the house (the 'about this property' blurb).",
    ),
  location: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Place name of the property, e.g. 'Rua Passos Manuel, Lisboa, Portugal'. " +
        "Geocoded so the property's map/Location card appears. Use a specific " +
        "address or town + country.",
    ),
  rooms: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Titles of the rentable rooms (units) to create in this house, e.g. " +
        "['Room 1', 'Room 2']. Each becomes a unit you can later attach a room " +
        "listing to. Omit to create the house with no rooms yet.",
    ),
  marketValue: z
    .number()
    .nonnegative()
    .optional()
    .describe("Estimated market value in EUR (portfolio-value card)."),
  generatesIncome: z
    .boolean()
    .optional()
    .describe("Whether the property is rented out (true) vs. personal use."),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  houseFeatures: z
    .array(z.enum(HOUSE_FEATURE_KEYS))
    .optional()
    .describe(`Shared-house amenities. Allowed keys: ${HOUSE_FEATURE_KEYS.join(", ")}.`),
} as const;

export type CreatePropertyArgs = {
  title: string;
  description?: string;
  location?: string;
  rooms?: string[];
  marketValue?: number;
  generatesIncome?: boolean;
  bedrooms?: number;
  bathrooms?: number;
  houseFeatures?: (typeof HOUSE_FEATURE_KEYS)[number][];
};

// Turns the tool args into the CreatePropertyInput the API layer wants: geocodes
// `location` to lat/lon (the BE reverse-resolves the freguesia) and passes the
// rest through. Shared by the user and admin create tools.
export async function buildCreateInput(
  { location, ...rest }: CreatePropertyArgs,
  listingsApi: ListingsApi,
  token: string,
): Promise<{ value: CreatePropertyInput } | { error: string }> {
  const value: CreatePropertyInput = { title: rest.title };
  if (rest.description !== undefined) value.description = rest.description;
  if (rest.rooms) value.rooms = rest.rooms;
  if (rest.marketValue !== undefined) value.marketValue = rest.marketValue;
  if (rest.generatesIncome !== undefined)
    value.generatesIncome = rest.generatesIncome;
  if (rest.bedrooms !== undefined) value.bedrooms = rest.bedrooms;
  if (rest.bathrooms !== undefined) value.bathrooms = rest.bathrooms;
  if (rest.houseFeatures) value.houseFeatures = rest.houseFeatures;

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
    "create_property",
    "Create a property (a house/portfolio) for the authenticated user, " +
      "optionally with its rooms. This is the house that rooms belong to — the " +
      "structure `list_properties` returns — NOT a listing. A property here is " +
      "always a room-rental house; pass `rooms` to create its rentable units " +
      "(rooms) in the same call. Pass `location` (a place name) so the map/" +
      "Location card appears — it is geocoded. After creating, use " +
      "`create_listing` to advertise a room.\n\n" +
      "Note: `create_listing` does not attach to a property's unit — creating " +
      "the house here gives you the portfolio structure; the room listing stays " +
      "a separate advert.",
    CREATE_PROPERTY_FIELDS,
    {
      title: "Create property",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      // Geocoding hits an external service when `location` is passed.
      openWorldHint: true,
    },
    authedHandler(deps, async (args: CreatePropertyArgs, { token }) => {
      const input = await buildCreateInput(args, listingsApi, token);
      if ("error" in input) return errorText(input.error);
      const result = await api.createProperty(input.value, token);
      return result.ok
        ? text(
            `Property "${args.title}" created` +
              (args.rooms?.length
                ? ` with ${args.rooms.length} room(s)`
                : "") +
              `.\n${result.body}`,
          )
        : errorText(
            `Property creation failed (status ${result.status}): ${result.body}`,
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
      description: z
        .string()
        .optional()
        .describe(
          "Free-text description of the house (the 'about this property' blurb).",
        ),
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

  server.tool(
    "update_property_electricity",
    "Set the electricity contract of one of the user's properties (the " +
      "Electricity card in the property settings): supplier, CPE, contracted " +
      "power, tariff option, indexed, social tariff, and what the house pays " +
      "today (energy price per period, power price per day, yearly kWh) so " +
      "offers are compared against the real price. This REPLACES the " +
      "whole contract — any field you omit is cleared — so pass everything " +
      "you know, e.g. read it off the supplier's invoice. The id comes from " +
      "list_properties — never guess it.",
    {
      propertyId: z.string().min(1).describe("The property's id (UUID)."),
      provider: z
        .string()
        .nullable()
        .optional()
        .describe(
          "ERSE supplier code, e.g. 'EDPC' (EDP Comercial), 'GOLD' " +
            "(Goldenergy), 'IBD' (Iberdrola), 'END' (Endesa), 'GALP', " +
            "'REPSOL', 'MEOENERGIA', 'ENIPLENITUDE', 'TUR' (regulated); or 'other'. " +
            "The backend rejects unknown codes — relay its error.",
        ),
      cpe: z
        .string()
        .nullable()
        .optional()
        .describe("CPE code from the invoice, e.g. 'PT0002000037225289ZE'."),
      contractedPowerKva: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Contracted power in kVA, e.g. 6.9."),
      tariffOption: z
        .enum(ELECTRICITY_TARIFF_OPTIONS)
        .nullable()
        .optional()
        .describe(
          "simple = 'Simples', bi = 'Bi-horário', tri = 'Tri-horário'.",
        ),
      indexed: z
        .boolean()
        .optional()
        .describe("True for an indexed (dynamic price) tariff."),
      socialTariff: z
        .boolean()
        .optional()
        .describe("True if the contract has the social tariff (Tarifa Social)."),
      energyPrice1: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Energy price in €/kWh WITHOUT VAT, off the invoice (after any campaign " +
            "discount). Simple tariff: the one price; bi: fora de vazio; tri: ponta."),
      energyPrice2: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("€/kWh without VAT: bi = vazio; tri = cheias. Omit on simple."),
      energyPrice3: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("€/kWh without VAT: tri = vazio. Omit on simple/bi."),
      powerPricePerDay: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Power term in €/day WITHOUT VAT: contracted power plus grid access " +
            "(on Goldenergy invoices, add the two 'Potência' lines)."),
      annualKwh: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional()
        .describe(
          "Yearly usage in kWh. If the invoice gives the daily average, " +
            "multiply by 365.",
        ),
    },
    {
      title: "Update property electricity",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ propertyId, ...input }: UpdateElectricityArgs, { token }) => {
        const result = await api.updateElectricity(propertyId, input, token);
        return result.ok
          ? text(`Electricity for property ${propertyId} updated.
${result.body}`)
          : errorText(
              `Electricity update failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );

  server.tool(
    "update_property_gas",
    "Set the natural gas contract of one of the user's properties (the Gas " +
      "card in the property settings): supplier, CUI, escalão (tier), what the " +
      "house pays today and yearly usage, and whether gas comes on the same " +
      "dual invoice as electricity. This REPLACES the whole gas contract — any " +
      "field you omit is cleared. The id comes from list_properties.",
    {
      propertyId: z.string().min(1).describe("The property's id (UUID)."),
      provider: z
        .string()
        .nullable()
        .optional()
        .describe("ERSE supplier code, e.g. 'GOLD', 'EDPC', 'GALP', 'IBD'; or 'other'."),
      cui: z
        .string()
        .nullable()
        .optional()
        .describe("CUI code from the gas invoice, e.g. 'PT1605000008068516VM'."),
      tier: z
        .number()
        .int()
        .min(GAS_TIERS[0])
        .max(GAS_TIERS[GAS_TIERS.length - 1])
        .nullable()
        .optional()
        .describe(
          "Escalão from the invoice, by m3 a year: 1 up to 220, 2 221-500, " +
            "3 501-1000, 4 1001-10000.",
        ),
      energyPrice: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Gas price in €/kWh WITHOUT VAT, after any campaign discount."),
      fixedPricePerDay: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe(
          "Fixed term in €/day WITHOUT VAT: termo fixo plus 'acesso às redes' per day.",
        ),
      annualKwh: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional()
        .describe("Yearly gas usage in kWh (the invoice converts m3 to kWh)."),
      sameBillAsElectricity: z
        .boolean()
        .optional()
        .describe("True when electricity and gas come on one dual invoice paid as one value."),
    },
    {
      title: "Update property gas",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ propertyId, ...input }: UpdateGasArgs, { token }) => {
        const result = await api.updateGas(propertyId, input, token);
        return result.ok
          ? text(`Gas for property ${propertyId} updated.
${result.body}`)
          : errorText(`Gas update failed (status ${result.status}): ${result.body}`);
      },
    ),
  );
}

type UpdateElectricityArgs = ElectricityInput & { propertyId: string };
type UpdateGasArgs = GasInput & { propertyId: string };

type UpdatePropertyArgs = {
  propertyId: string;
  location?: string;
  title?: string;
  description?: string;
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
