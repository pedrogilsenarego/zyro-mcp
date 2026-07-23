import type { BackendClient } from "../../backend/client.js";

export type SearchBusinessType = "sale" | "rent" | "auction" | "roomRent";

export type SearchListingsParams = {
  businessType?: SearchBusinessType;
  locationName?: string;
  realEstateType?: string;
  bedroomsIn?: string;
  availableFrom?: string;
  limit?: number;
  page?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export type SearchListingSummary = {
  id: string;
  slug: string | null;
  title: string | null;
  businessType: string | null;
  listingType: string | null;
  rentPrice: string | null;
  salePrice: string | null;
  locationName: string | null;
  houseTitle: string | null;
  createdAt: string | null;
};

export type SearchListingsResult =
  | {
      ok: true;
      status: number;
      listings: SearchListingSummary[];
      total: number;
      totalListings: number;
      ms: number;
    }
  | { ok: false; status: number; body: string; ms: number };

// Searches the PUBLIC marketplace directory via GET /real-estate — the same
// endpoint the website's search uses. Unlike the listings module (which acts on
// the caller's OWN listings via /listing/*), this spans all owners and only
// returns publicly active supply listings.
export class SearchApi {
  constructor(private readonly client: BackendClient) {}

  async searchPublicListings(
    params: SearchListingsParams,
    accessToken: string,
  ): Promise<SearchListingsResult> {
    const qs = new URLSearchParams();
    // businessType is omitted for roomRent — the backend defaults to it, and
    // passing an explicit value there would fall outside its typed set.
    if (params.businessType && params.businessType !== "roomRent") {
      qs.set("businessType", params.businessType);
    }
    if (params.locationName) qs.set("locationName", params.locationName);
    // The real FE default search always carries these — include them so timing
    // tests measure the query the app actually runs, not a simplified one.
    if (params.realEstateType) qs.set("realEstateType", params.realEstateType);
    if (params.bedroomsIn) qs.set("bedroomsIn", params.bedroomsIn);
    if (params.availableFrom) qs.set("availableFrom", params.availableFrom);
    qs.set("limit", String(params.limit ?? 20));
    qs.set("page", String(params.page ?? 1));
    if (params.sortBy) {
      qs.set("sortBy", params.sortBy);
      qs.set("sortDir", params.sortDir ?? "desc");
    }

    const started = Date.now();
    const res = await this.client.request(`/real-estate?${qs}`, {
      accessToken,
    });
    const ms = Date.now() - started;

    if (!res.ok) return { ok: false, status: res.status, body: res.body, ms };

    const parsed = parseSearch(res.body);
    return {
      ok: true,
      status: res.status,
      listings: parsed.listings,
      total: parsed.total,
      totalListings: parsed.totalListings,
      ms,
    };
  }
}

function parseSearch(body: string): {
  listings: SearchListingSummary[];
  total: number;
  totalListings: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { listings: [], total: 0, totalListings: 0 };
  }
  const root = (parsed ?? {}) as {
    data?: unknown;
    metadata?: { pagination?: { total?: unknown; totalListings?: unknown } };
  };
  const rows = Array.isArray(root.data) ? root.data : [];
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (v: unknown) => (v == null ? null : String(v));

  const listings = rows.map((row): SearchListingSummary => {
    const r = (row ?? {}) as {
      realEstate?: Record<string, unknown>;
      location?: Record<string, unknown>;
    };
    const re = r.realEstate ?? {};
    const loc = r.location ?? {};
    const portfolio = (re.portfolioData ?? null) as {
      title?: unknown;
    } | null;
    return {
      id: String(re.id ?? ""),
      slug: str(re.slug),
      title: str(re.title),
      businessType: str(re.businessType),
      listingType: str(re.listingType),
      rentPrice: str(re.rentPrice),
      salePrice: str(re.salePrice),
      locationName: str(loc.name) ?? str(loc.normalizedName),
      houseTitle: portfolio ? str(portfolio.title) : null,
      createdAt: str(re.createdAt),
    };
  });

  return {
    listings,
    total: num(root.metadata?.pagination?.total),
    totalListings: num(root.metadata?.pagination?.totalListings),
  };
}
