import type { BackendClient, BackendResult } from "../../backend/client.js";
import type { UpdatePropertyInput } from "../../generated/contracts.js";

export type { UpdatePropertyInput };

// Raw BE fields the adapter reads off each property row; the contract test
// asserts they still exist on GET /property.
export const PROPERTY_SOURCE_FIELDS = [
  "id",
  "title",
  "bedrooms",
  "bathrooms",
  "generatesIncome",
  "businesses",
] as const;

// Raw fields the adapter reads off each unit (nested under businesses[].units[]).
export const PROPERTY_UNIT_SOURCE_FIELDS = ["id", "title", "unitType"] as const;

// Numeric codes the BE stores for a room-rental portfolio. Mirrors the FE
// PortfolioBusinessType.Rooms / UnitBusinessType.Room enums — a property here is
// always a room-rental house (businessType 1) whose units are rooms (unitType 1),
// matching the only create path the app exposes. Sent as strings; the BE
// Number()s them.
export const PROPERTY_ROOMS_BUSINESS_TYPE = "1";
export const PROPERTY_ROOM_UNIT_TYPE = "1";

// Fields the create tools collect. `rooms` are the unit (room) titles that become
// the property's rentable units; `latitude`/`longitude` come from geocoding a
// place name in the tool layer (the BE reverse-resolves the freguesia from them).
export type CreatePropertyInput = {
  title: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  bedrooms?: number;
  bathrooms?: number;
  marketValue?: number;
  generatesIncome?: boolean;
  houseFeatures?: string[];
  rooms?: string[];
};

// Builds the multipart body POST /property/add (and the admin variant) expect:
// scalars stringified, `houseFeatures` JSON-stringified, and a single Rooms
// business carrying the rooms as units. The BE requires at least one business,
// so we always send one even when there are no rooms yet. Shared by the user and
// admin create paths so the encoding can't drift between them.
export function buildPropertyForm(input: CreatePropertyInput): FormData {
  const form = new FormData();
  form.append("title", input.title);
  if (input.description !== undefined) {
    form.append("description", input.description);
  }

  const scalars: Record<string, unknown> = {
    latitude: input.latitude,
    longitude: input.longitude,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    marketValue: input.marketValue,
    generatesIncome: input.generatesIncome,
  };
  for (const [key, value] of Object.entries(scalars)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }

  if (input.houseFeatures && input.houseFeatures.length > 0) {
    form.append("houseFeatures", JSON.stringify(input.houseFeatures));
  }

  const units = (input.rooms ?? []).map((title) => ({
    title,
    unitType: PROPERTY_ROOM_UNIT_TYPE,
  }));
  form.append(
    "businesses",
    JSON.stringify([{ businessType: PROPERTY_ROOMS_BUSINESS_TYPE, units }]),
  );

  return form;
}

export interface PropertyUnitSummary {
  id: string;
  title: string | null;
  unitType: number | null;
}

export interface PropertySummary {
  id: string;
  title: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  // Whether the property is rented out vs. personal use.
  generatesIncome: boolean | null;
  // Rentable units (rooms) flattened across the property's businesses. Cross-
  // reference a unit/property with list_guests events to reason about vacancy.
  units: PropertyUnitSummary[];
}

export type ListPropertiesResult =
  | { ok: true; status: number; properties: PropertySummary[] }
  | { ok: false; status: number; body: string };

export class PropertiesApi {
  constructor(private readonly client: BackendClient) {}

  // Lists the caller's properties with their units. Identity comes from the
  // token — GET /property resolves the user itself. The BE caps limit at 1000
  // (its own default), enough to return the whole portfolio in one call.
  async listProperties(accessToken: string): Promise<ListPropertiesResult> {
    const res = await this.client.request("/property?limit=1000", {
      accessToken,
    });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, properties: toSummaries(res.body) };
  }

  // Creates a property (house/portfolio) owned by the caller — identity comes
  // from the token, POST /property/add reads it itself. Multipart, mirroring the
  // app's own create flow (see buildPropertyForm). Returns the raw BE result.
  createProperty(
    input: CreatePropertyInput,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request("/property/add", {
      method: "POST",
      accessToken,
      body: buildPropertyForm(input),
    });
  }

  // Updates the caller's own property (house/portfolio). Identity comes from the
  // token — PUT /property/:id asserts edit access itself. Only the passed fields
  // change. Sent as JSON (the BE reads c.req.json()).
  updateProperty(
    propertyId: string,
    input: UpdatePropertyInput,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(`/property/${encodeURIComponent(propertyId)}`, {
      method: "PUT",
      accessToken,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    });
  }
}

function toSummaries(body: string): PropertySummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed as { data?: unknown })?.data ?? []);
  if (!Array.isArray(rows)) return [];

  const str = (v: unknown) => (v == null ? null : String(v));
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const bool = (v: unknown) => (v == null ? null : Boolean(v));

  return rows.map((row): PropertySummary => {
    const r = row as Record<string, unknown>;
    const businesses = Array.isArray(r.businesses) ? r.businesses : [];
    const units: PropertyUnitSummary[] = [];
    for (const b of businesses) {
      const bizUnits = (b as Record<string, unknown>)?.units;
      if (!Array.isArray(bizUnits)) continue;
      for (const u of bizUnits) {
        const unit = u as Record<string, unknown>;
        units.push({
          id: String(unit.id ?? ""),
          title: str(unit.title),
          unitType: num(unit.unitType),
        });
      }
    }
    return {
      id: String(r.id ?? ""),
      title: str(r.title),
      bedrooms: num(r.bedrooms),
      bathrooms: num(r.bathrooms),
      generatesIncome: bool(r.generatesIncome),
      units,
    };
  });
}
