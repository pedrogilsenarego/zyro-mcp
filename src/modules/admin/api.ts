import type { BackendClient, BackendResult } from "../../backend/client.js";
import type {
  CreateListingInput,
  UpdateListingInput,
  UpdatePropertyInput,
} from "../../generated/contracts.js";
import { buildPropertyForm, type CreatePropertyInput } from "../properties/api.js";

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
  // Publish status: active | draft | inactive (admins see all).
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

// Raw BE fields the property adapter reads off each row; the contract test
// asserts they still exist on GET /admin/users/:userId/portfolios.
export const ADMIN_PROPERTY_SOURCE_FIELDS = [
  "id",
  "title",
  "latitude",
  "longitude",
  "marketValue",
] as const;

export interface AdminPropertyUnitSummary {
  id: string;
  title: string | null;
  // The listing (realEstate) currently associated to this unit, or null when
  // the room shows "No listing associated". Pass a unit's id as `unitId` to
  // admin_create_listing to link a new advert to it.
  listingId: string | null;
}

export interface AdminPropertySummary {
  id: string;
  title: string | null;
  latitude: string | null;
  longitude: string | null;
  marketValue: string | null;
  // Convenience flag: the property has map coordinates (drives whether the
  // Location card / map can render). Cheaper for the model than comparing
  // latitude/longitude itself.
  hasLocation: boolean;
  // Rentable units (rooms), flattened across the property's businesses, with
  // whether each already has a listing associated.
  units: AdminPropertyUnitSummary[];
}

export type ListUserPropertiesResult =
  | { ok: true; status: number; properties: AdminPropertySummary[] }
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

  // Lists any user's properties (houses/portfolios) via the admin backoffice
  // endpoint, curated to id + title + coordinates + market value so an admin can
  // find a property's id and see whether it has a location. Admin-gated by the
  // backend — a non-admin token gets a 403 we relay verbatim.
  async listUserProperties(
    userId: string,
    accessToken: string,
  ): Promise<ListUserPropertiesResult> {
    const res = await this.client.request(
      `/admin/users/${encodeURIComponent(userId)}/portfolios`,
      { accessToken },
    );
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return {
      ok: true,
      status: res.status,
      properties: toPropertySummaries(res.body),
    };
  }

  // Creates a property OWNED BY `ownerId` via the admin backoffice endpoint
  // (POST /admin/portfolios). Like admin_create_listing, the owner is passed as
  // the form's `userId` field — the one place a user id is data not token — and
  // it's admin-gated (requireAdmin). Reuses buildPropertyForm so the encoding
  // matches the owner's own create path exactly.
  createPropertyForUser(
    ownerId: string,
    input: CreatePropertyInput,
    accessToken: string,
  ): Promise<BackendResult> {
    const form = buildPropertyForm(input);
    form.append("userId", ownerId);
    return this.client.request("/admin/portfolios", {
      method: "POST",
      accessToken,
      body: form,
    });
  }

  // Sets any listing's publish status via the admin backoffice endpoint
  // (POST /admin/listings/:id/publish-status). The backend resolves the owner
  // and runs the owner's own updatePublishStatus path — so the plan active-
  // listing cap, email-verification and other publish-time gates still apply
  // (relayed verbatim on failure). Admin-gated — a non-admin token gets a 403.
  setPublishStatusForUser(
    listingId: string,
    status: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/listings/${encodeURIComponent(listingId)}/publish-status`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({ isPublished: status }),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Updates any listing by id via the admin backoffice endpoint
  // (PATCH /admin/listings/:id). The backend resolves the owner from the listing
  // id and runs the owner's own update path, so there's no separate write
  // behaviour to drift. Sent as JSON (the BE reads c.req.json()). Admin-gated —
  // a non-admin token gets a 403 we relay verbatim.
  updateListingForUser(
    listingId: string,
    input: UpdateListingInput,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/listings/${encodeURIComponent(listingId)}`,
      {
        method: "PATCH",
        accessToken,
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Adds images to any listing by id via the admin backoffice endpoint
  // (PATCH /admin/listings/:id/images). Downloads each URL server-side (same as
  // createListingForUser) and appends them as the form's `imagesToAdd` files —
  // the backend keeps existing images and adds these. The BE resolves the owner
  // from the listing id, so there's no separate write path to drift. Admin-
  // gated — a non-admin token gets a 403 we relay verbatim.
  async addListingImagesForUser(
    listingId: string,
    imageUrls: string[],
    imagesToDelete: string[],
    linkImageUrls: string[],
    linkThumbnailUrls: string[],
    thumbnailsToDelete: string[],
    accessToken: string,
    fetchImpl: FetchLike = fetch,
  ): Promise<AdminCreateListingResult> {
    const { files, failed } = await downloadImages(imageUrls, fetchImpl);
    const form = new FormData();
    for (const { blob, filename } of files) {
      form.append("imagesToAdd", blob, filename);
    }
    if (imagesToDelete.length > 0) {
      form.append("imagesToDelete", JSON.stringify(imagesToDelete));
    }
    // Stored verbatim by the BE (no re-host), eGO-style.
    if (linkImageUrls.length > 0) {
      form.append("imageUrls", JSON.stringify(linkImageUrls));
    }
    if (linkThumbnailUrls.length > 0) {
      form.append("thumbnailUrls", JSON.stringify(linkThumbnailUrls));
    }
    if (thumbnailsToDelete.length > 0) {
      form.append("thumbnailsToDelete", JSON.stringify(thumbnailsToDelete));
    }

    const res = await this.client.request(
      `/admin/listings/${encodeURIComponent(listingId)}/images`,
      {
        method: "PATCH",
        accessToken,
        body: form,
      },
    );

    return {
      ok: res.ok,
      status: res.status,
      body: res.body,
      imagesAttached: files.length,
      imagesFailed: failed,
    };
  }

  // Re-links (or unlinks) any listing to a property unit via the admin
  // backoffice endpoint (PATCH /admin/listings/:id/resource). Sets the
  // listing's resourceId to the unit id (or null to unassociate) — the same
  // link create sets via `unitId`, but editable after the fact so no recreate
  // is needed. The BE resolves the owner from the listing id. Admin-gated — a
  // non-admin token gets a 403 we relay verbatim.
  setListingResourceForUser(
    listingId: string,
    resourceId: string | null,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/listings/${encodeURIComponent(listingId)}/resource`,
      {
        method: "PATCH",
        accessToken,
        body: JSON.stringify({ resourceId }),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Deletes any listing by id via the admin backoffice endpoint
  // (DELETE /admin/listings/:id). The backend resolves the owner from the
  // listing id and runs the owner's own remove path (soft-delete), so there's
  // no separate delete behaviour to drift. Admin-gated — a non-admin token
  // gets a 403 we relay verbatim.
  deleteListingForUser(
    listingId: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/listings/${encodeURIComponent(listingId)}`,
      {
        method: "DELETE",
        accessToken,
      },
    );
  }

  // Adds images to any property by id via the admin backoffice endpoint
  // (PATCH /admin/portfolios/:id/images). Downloads each URL server-side and
  // appends them as the form's `imagesToAdd` files — the backend keeps existing
  // images and adds these. The BE resolves the owner from the property id.
  // Admin-gated — a non-admin token gets a 403 we relay verbatim.
  async addPropertyImagesForUser(
    propertyId: string,
    imageUrls: string[],
    imagesToDelete: string[],
    linkImageUrls: string[],
    linkThumbnailUrls: string[],
    thumbnailsToDelete: string[],
    accessToken: string,
    fetchImpl: FetchLike = fetch,
  ): Promise<AdminCreateListingResult> {
    const { files, failed } = await downloadImages(imageUrls, fetchImpl);
    const form = new FormData();
    for (const { blob, filename } of files) {
      form.append("imagesToAdd", blob, filename);
    }
    if (imagesToDelete.length > 0) {
      form.append("imagesToDelete", JSON.stringify(imagesToDelete));
    }
    // Stored verbatim by the BE (no re-host), eGO-style. Properties carry a
    // `thumbnails` column too, index-aligned with `imageUrls`.
    if (linkImageUrls.length > 0) {
      form.append("imageUrls", JSON.stringify(linkImageUrls));
    }
    if (linkThumbnailUrls.length > 0) {
      form.append("thumbnailUrls", JSON.stringify(linkThumbnailUrls));
    }
    if (thumbnailsToDelete.length > 0) {
      form.append("thumbnailsToDelete", JSON.stringify(thumbnailsToDelete));
    }

    const res = await this.client.request(
      `/admin/portfolios/${encodeURIComponent(propertyId)}/images`,
      {
        method: "PATCH",
        accessToken,
        body: form,
      },
    );

    return {
      ok: res.ok,
      status: res.status,
      body: res.body,
      imagesAttached: files.length,
      imagesFailed: failed,
    };
  }

  // Grants (or updates) a user's MANUAL subscription via the admin backoffice
  // endpoint (POST /admin/users/:userId/subscriptions). The backend upserts the
  // user's single manual subscription — it updates the existing one in place if
  // present, or creates it otherwise — so this one call both sets and changes a
  // plan. It rejects (409) only when the user has an active EXTERNAL (Stripe)
  // subscription; that error is relayed verbatim. Admin-gated — a non-admin
  // token gets a 403 we relay verbatim.
  setSubscriptionForUser(
    userId: string,
    planCode: string,
    currentPeriodEnd: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/users/${encodeURIComponent(userId)}/subscriptions`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({ planCode, currentPeriodEnd }),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Deletes any property by id via the admin backoffice endpoint
  // (DELETE /admin/portfolios/:id). The backend resolves the owner from the
  // property id and runs the owner's own removeProperty path (cascades its
  // businesses, units and payment links, releases images), so there's no
  // separate delete behaviour to drift. Admin-gated — a non-admin token gets a
  // 403 we relay verbatim.
  deletePropertyForUser(
    propertyId: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/portfolios/${encodeURIComponent(propertyId)}`,
      {
        method: "DELETE",
        accessToken,
      },
    );
  }

  // Updates any property by id via the admin backoffice endpoint
  // (PUT /admin/portfolios/:id). The backend resolves the owner from the
  // property id and runs the owner's own update path, so there's no separate
  // write behaviour to drift. Admin-gated by the backend — a non-admin token
  // gets a 403 we relay verbatim.
  updatePropertyForUser(
    propertyId: string,
    input: UpdatePropertyInput,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/admin/portfolios/${encodeURIComponent(propertyId)}`,
      {
        method: "PUT",
        accessToken,
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function toPropertySummaries(body: string): AdminPropertySummary[] {
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

  const str = (v: unknown) => (v == null || v === "" ? null : String(v));

  return rows.map((row): AdminPropertySummary => {
    const r = row as Record<string, unknown>;
    const latitude = str(r.latitude);
    const longitude = str(r.longitude);
    const businesses = Array.isArray(r.businesses) ? r.businesses : [];
    const units: AdminPropertyUnitSummary[] = [];
    for (const b of businesses) {
      const bizUnits = (b as Record<string, unknown>)?.units;
      if (!Array.isArray(bizUnits)) continue;
      for (const u of bizUnits) {
        const unit = u as Record<string, unknown>;
        units.push({
          id: String(unit.id ?? ""),
          title: str(unit.title),
          listingId: str(unit.realEstateId),
        });
      }
    }
    return {
      id: String(r.id ?? ""),
      title: str(r.title),
      latitude,
      longitude,
      marketValue: str(r.marketValue),
      hasLocation: latitude != null && longitude != null,
      units,
    };
  });
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
