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
