import type { BackendClient, BackendResult } from "../../backend/client.js";
import type {
  CreateListingBase,
  CreateListingInput,
  UpdateListingInput,
} from "../../generated/contracts.js";

export type { CreateListingInput, UpdateListingInput };

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

// Raw BE fields toDetail reads (from GET /listing/:id). Read coverage must
// include every field update_listing can write, so the model can do relative
// edits (e.g. "remove desk") and confirm price/date before activating.
export const LISTING_DETAIL_SOURCE_FIELDS = [
  "id",
  "reference",
  "title",
  "description",
  "isPublished",
  "listingType",
  "businessType",
  "rentPrice",
  "deposit",
  "availableFrom",
  "availableTo",
  "roomFeatures",
  "houseFeatures",
  "smokingAllowed",
  "petFriendly",
  "gender",
  "maxPersons",
  "bedrooms",
  "bathrooms",
  "matchAlertsEnabled",
] as const;

export type CreateListingArgs = CreateListingBase & {
  listingType?: "supply" | "demand";
  location?: string;
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

export type ListingDetail = {
  id: string;
  reference: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  listingType: string | null;
  businessType: string | null;
  rentPrice: string | null;
  deposit: string | null;
  availableFrom: string | null;
  availableTo: string | null;
  roomFeatures: string[];
  houseFeatures: string[];
  smokingAllowed: boolean | null;
  petFriendly: boolean | null;
  gender: string | null;
  maxPersons: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  matchAlertsEnabled: boolean | null;
};

export type GetListingResult =
  | { ok: true; status: number; listing: ListingDetail }
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

  setPublishStatus(
    listingId: string,
    status: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/listing/${encodeURIComponent(listingId)}/publish-status`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({ isPublished: status }),
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

  async getListing(
    listingId: string,
    accessToken: string,
  ): Promise<GetListingResult> {
    const res = await this.client.request(
      `/listing/${encodeURIComponent(listingId)}`,
      { accessToken },
    );
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    const detail = toDetail(res.body);
    if (!detail) {
      return { ok: false, status: 404, body: "Listing not found." };
    }
    return { ok: true, status: res.status, listing: detail };
  }

  // Lists a user's listings via GET /listing/user/:userId. For the caller's own
  // id the backend returns every status; for any other user it returns only
  // publicly active listings (curated to public fields — no owner/personal data).
  async listListingsByUser(
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

function toDetail(body: string): ListingDetail | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const row = (parsed as { data?: unknown })?.data ?? parsed;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!r.id) return null;

  const str = (v: unknown) => (v == null ? null : String(v));
  const bool = (v: unknown) => (v == null ? null : Boolean(v));
  const num = (v: unknown) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const strArray = (v: unknown) =>
    Array.isArray(v) ? v.map(String) : [];

  return {
    id: String(r.id),
    reference: str(r.reference),
    title: str(r.title),
    description: str(r.description),
    status: str(r.isPublished),
    listingType: str(r.listingType),
    businessType: str(r.businessType),
    rentPrice: str(r.rentPrice),
    deposit: str(r.deposit),
    availableFrom: str(r.availableFrom),
    availableTo: str(r.availableTo),
    roomFeatures: strArray(r.roomFeatures),
    houseFeatures: strArray(r.houseFeatures),
    smokingAllowed: bool(r.smokingAllowed),
    petFriendly: bool(r.petFriendly),
    gender: str(r.gender),
    maxPersons: num(r.maxPersons),
    bedrooms: num(r.bedrooms),
    bathrooms: num(r.bathrooms),
    matchAlertsEnabled: bool(r.matchAlertsEnabled),
  };
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
