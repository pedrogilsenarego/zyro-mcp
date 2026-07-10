import type { BackendClient, BackendResult } from "../../backend/client.js";
import type {
  CreateListingBase,
  CreateListingInput,
  HouseFeatureKey,
  RoomFeatureKey,
} from "../../generated/contracts.js";

export type { CreateListingInput };

// Raw BE fields toSummaries reads; the contract test asserts they still exist.
export const LISTING_SOURCE_FIELDS = [
  "id",
  "reference",
  "title",
  "isPublished",
  "listingType",
  "businessType",
  "realEstateType",
  "rentPrice",
  "salePrice",
  "createdAt",
] as const;

export type CreateListingArgs = CreateListingBase & {
  listingType?: "supply" | "demand";
  location?: string;
};

// Every field optional — a PATCH only sends what changes. The BE strips
// id/userId itself and enforces edit access before applying the update.
export type UpdateListingInput = {
  title?: string;
  rentPrice?: number;
  salePrice?: number;
  availableFrom?: string | null;
  roomFeatures?: RoomFeatureKey[];
  houseFeatures?: HouseFeatureKey[];
  smokingAllowed?: boolean;
  deposit?: number | null;
};

export type ListingSummary = {
  id: string;
  reference: string | null;
  title: string | null;
  status: string | null;
  listingType: string | null;
  businessType: string | null;
  propertyType: string | null;
  rentPrice: string | null;
  salePrice: string | null;
  createdAt: string | null;
};

export type ListMyListingsResult =
  | { ok: true; status: number; listings: ListingSummary[] }
  | { ok: false; status: number; body: string };

export class ListingsApi {
  constructor(private readonly client: BackendClient) {}

  createListing(
    input: CreateListingInput,
    accessToken: string,
  ): Promise<BackendResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      // Arrays are JSON-stringified; the BE JSON.parses them.
      form.append(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    }
    return this.client.request("/listing/add", {
      method: "POST",
      accessToken,
      body: form,
    });
  }

  updateListing(
    listingId: string,
    input: UpdateListingInput,
    accessToken: string,
  ): Promise<BackendResult> {
    // BE reads this as JSON (c.req.json()), so send a JSON body — not the
    // multipart form createListing uses.
    return this.client.request(
      `/listing/${encodeURIComponent(listingId)}`,
      {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  async geocode(
    query: string,
    accessToken: string,
  ): Promise<{ lat: number; lon: number } | null> {
    const qs = new URLSearchParams({
      q: query,
      format: "json",
      limit: "1",
      countrycodes: "pt",
    });
    const res = await this.client.request(`/nominatim/search?${qs}`, {
      accessToken,
    });
    if (!res.ok) return null;
    try {
      const parsed = JSON.parse(res.body) as {
        data?: Array<{ lat?: string; lon?: string }>;
      };
      const first = parsed.data?.[0];
      if (!first?.lat || !first?.lon) return null;
      const lat = Number(first.lat);
      const lon = Number(first.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  deleteListing(
    listingId: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/listing/${encodeURIComponent(listingId)}`,
      { method: "DELETE", accessToken },
    );
  }

  async listMyListings(
    userId: string,
    accessToken: string,
  ): Promise<ListMyListingsResult> {
    const res = await this.client.request(
      `/listing/user/${encodeURIComponent(userId)}`,
      { accessToken },
    );
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, listings: toSummaries(res.body) };
  }
}

function toSummaries(body: string): ListingSummary[] {
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

  return rows.map((row): ListingSummary => {
    const r = row as Record<string, unknown>;
    const str = (v: unknown) => (v == null ? null : String(v));
    const businessType = str(r.businessType);
    // realEstateType is null for rooms → fall back to "room".
    const propertyType =
      str(r.realEstateType) ?? (businessType === "roomRent" ? "room" : null);
    return {
      id: String(r.id ?? ""),
      reference: str(r.reference),
      title: str(r.title),
      status: str(r.isPublished),
      listingType: str(r.listingType),
      businessType,
      propertyType,
      rentPrice: str(r.rentPrice),
      salePrice: str(r.salePrice),
      createdAt: str(r.createdAt),
    };
  });
}
