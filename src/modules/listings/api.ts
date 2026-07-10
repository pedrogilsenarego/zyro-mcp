import type { BackendClient, BackendResult } from "../../backend/client.js";

/**
 * Raw BE fields `toSummaries` reads. This list is the contract with the
 * backend — the contract test asserts a live response still carries them, so a
 * rename/removal on the BE fails loudly here instead of silently nulling a
 * column. Keep in sync with `toSummaries`.
 */
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

export interface CreateListingInput {
  title: string;
  rentPrice: number;
  propertyType: string;
  businessType: string;
  listingType?: "supply" | "demand";
}

/** Assistant-facing subset of a listing (curated from the raw BE payload). */
export interface ListingSummary {
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
}

export type ListMyListingsResult =
  | { ok: true; status: number; listings: ListingSummary[] }
  | { ok: false; status: number; body: string };

/** Thin HTTP calls for the listing domain. No business logic. */
export class ListingsApi {
  constructor(private readonly client: BackendClient) {}

  createListing(
    input: CreateListingInput,
    accessToken: string,
  ): Promise<BackendResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    return this.client.request("/listing/add", {
      method: "POST",
      accessToken,
      body: form,
    });
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

  /**
   * The caller's own (and shared-with) listings — includes drafts/inactive,
   * excludes deleted. `userId` is resolved from the JWT, never a tool argument.
   * Returns a curated summary per listing, not the raw BE payload.
   */
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
    // realEstateType is denormalized and null for rooms, so fall back to "room"
    // when the business is a room rental.
    const propertyType =
      str(r.realEstateType) ??
      (businessType === "roomRent" ? "room" : null);
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
