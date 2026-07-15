import type { BackendClient } from "../../backend/client.js";
import type { CreateListingInput } from "../../generated/contracts.js";

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

// Same shape create_listing builds, plus the free-text description (which the
// BE create pipeline accepts but the non-admin tool doesn't yet send).
export type AdminCreateListingInput = CreateListingInput & {
  description?: string;
};

export type AdminCreateListingResult = {
  ok: boolean;
  status: number;
  body: string;
  // How many of the supplied image URLs were downloaded and attached, and which
  // ones we couldn't fetch — so the tool can tell the admin what made it in.
  imagesAttached: number;
  imagesFailed: string[];
};

type FetchLike = (url: string) => Promise<Response>;

// Downloads each image URL server-side and returns them as blobs to attach to
// the multipart form. This is why scraped images work where pasted ones don't:
// the URLs are plain strings the model can pass, and WE fetch the bytes. Bad or
// non-image URLs are skipped and reported rather than failing the whole create.
export async function downloadImages(
  urls: string[],
  fetchImpl: FetchLike = fetch,
): Promise<{ files: { blob: Blob; filename: string }[]; failed: string[] }> {
  const files: { blob: Blob; filename: string }[] = [];
  const failed: string[] = [];

  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetchImpl(url);
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.startsWith("image/")) {
        failed.push(url);
        continue;
      }
      const blob = await res.blob();
      const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
      files.push({ blob, filename: `image-${i + 1}.${ext}` });
    } catch {
      failed.push(url);
    }
  }

  return { files, failed };
}

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

  // Creates a listing OWNED BY `ownerId` via the admin backoffice endpoint
  // (POST /admin/listings). The backend reads the owner from the form's
  // `userId` field — the one place a user id is passed as data rather than
  // taken from the token, and it's admin-gated (requireAdmin). Mirrors the
  // multipart encoding the non-admin createListing uses (arrays JSON-stringified,
  // scalars stringified), plus `userId` and any downloaded image files.
  async createListingForUser(
    ownerId: string,
    input: AdminCreateListingInput,
    imageUrls: string[],
    accessToken: string,
    fetchImpl: FetchLike = fetch,
  ): Promise<AdminCreateListingResult> {
    const form = new FormData();
    form.append("userId", ownerId);
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      form.append(
        key,
        Array.isArray(value) ? JSON.stringify(value) : String(value),
      );
    }

    const { files, failed } = await downloadImages(imageUrls, fetchImpl);
    for (const { blob, filename } of files) {
      form.append("images", blob, filename);
    }

    const res = await this.client.request("/admin/listings", {
      method: "POST",
      accessToken,
      body: form,
    });

    return {
      ok: res.ok,
      status: res.status,
      body: res.body,
      imagesAttached: files.length,
      imagesFailed: failed,
    };
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
