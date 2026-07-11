import type { BackendClient } from "../../backend/client.js";

// Raw BE fields the adapter reads off each admin listing row; the contract test
// asserts they still exist on GET /admin/listings.
export const ADMIN_LISTING_SOURCE_FIELDS = [
  "id",
  "title",
  "listingType",
  "isPublished",
  "createdAt",
  "ownerId",
  "ownerName",
  "ownerEmail",
] as const;

export interface AdminListingSummary {
  id: string;
  title: string | null;
  listingType: string | null;
  // Publish status: active | draft | inactive | rented (admins see all).
  status: string | null;
  createdAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  portfolioTitle: string | null;
  unitTitle: string | null;
}

export type ListUserListingsResult =
  | {
      ok: true;
      status: number;
      listings: AdminListingSummary[];
      total: number;
    }
  | { ok: false; status: number; body: string };

export class AdminApi {
  constructor(private readonly client: BackendClient) {}

  // Lists any user's listings across ALL statuses (draft/inactive included) via
  // the admin backoffice endpoint. Admin-gated by the backend — a non-admin
  // token gets a 403 which we relay verbatim.
  async listUserListings(
    userId: string,
    limit: number,
    accessToken: string,
  ): Promise<ListUserListingsResult> {
    const qs = new URLSearchParams({ userId, limit: String(limit) });
    const res = await this.client.request(`/admin/listings?${qs.toString()}`, {
      accessToken,
    });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    const { listings, total } = toSummaries(res.body);
    return { ok: true, status: res.status, listings, total };
  }
}

function toSummaries(body: string): {
  listings: AdminListingSummary[];
  total: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { listings: [], total: 0 };
  }
  const envelope = parsed as {
    data?: unknown;
    pagination?: { total?: number };
  };
  const rows = Array.isArray(parsed) ? parsed : (envelope?.data ?? []);
  if (!Array.isArray(rows)) return { listings: [], total: 0 };

  const str = (v: unknown) => (v == null ? null : String(v));

  const listings = rows.map((row): AdminListingSummary => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      title: str(r.title),
      listingType: str(r.listingType),
      status: str(r.isPublished),
      createdAt: str(r.createdAt),
      ownerId: str(r.ownerId),
      ownerName: str(r.ownerName),
      ownerEmail: str(r.ownerEmail),
      portfolioTitle: str(r.portfolioTitle),
      unitTitle: str(r.unitTitle),
    };
  });

  const total =
    typeof envelope?.pagination?.total === "number"
      ? envelope.pagination.total
      : listings.length;

  return { listings, total };
}
