import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import {
  ListingsApi,
  LISTING_SOURCE_FIELDS,
  LISTING_DETAIL_SOURCE_FIELDS,
} from "./api.js";

/** Minimal fake client that returns a canned response for any request. */
function fakeClient(response: {
  ok: boolean;
  status: number;
  body: string;
}): BackendClient {
  return { request: async () => response } as unknown as BackendClient;
}

/** Fake client that records the (path, opts) of every request it receives. */
function capturingClient(response: { ok: boolean; status: number; body: string }) {
  const calls: { path: string; opts: any }[] = [];
  const client = {
    request: async (path: string, opts: any = {}) => {
      calls.push({ path, opts });
      return response;
    },
  } as unknown as BackendClient;
  return { client, calls };
}

// A raw row carries far more than we surface; the extra field must be dropped.
const RAW_ROWS = [
  {
    id: "room-1",
    reference: "IMO-ROOM",
    title: "A room",
    isPublished: "active",
    listingType: "supply",
    businessType: "roomRent",
    realEstateType: null,
    rentPrice: "400.00",
    salePrice: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    energyCertificationEmission: "junk we should not surface",
  },
  {
    id: "apt-1",
    reference: "IMO-APT",
    title: "An apartment",
    isPublished: "inactive",
    listingType: "supply",
    businessType: "rent",
    realEstateType: "apartment",
    rentPrice: "900.00",
    salePrice: null,
    createdAt: "2026-02-02T00:00:00.000Z",
  },
];

test("listMyListings maps the BE payload to curated summaries", async () => {
  const api = new ListingsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify({ data: RAW_ROWS }) }),
  );

  const result = await api.listMyListings("user-1", "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.listings.length, 2);

  const [room, apt] = result.listings;
  // Denormalized realEstateType is null for rooms → fall back to "room".
  assert.equal(room.propertyType, "room");
  // Non-room keeps the real type.
  assert.equal(apt.propertyType, "apartment");

  assert.equal(room.status, "active");
  assert.equal(room.rentPrice, "400.00");
  assert.equal(apt.status, "inactive");

  // Curated: fields we don't surface must not leak through.
  assert.ok(!("energyCertificationEmission" in room));
});

test("listMyListings relays a backend error instead of throwing", async () => {
  const api = new ListingsApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.listMyListings("user-1", "token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  assert.equal(result.body, "Forbidden");
});

test("getListing curates the BE detail and defaults missing arrays", async () => {
  const raw = {
    id: "room-1",
    reference: "IMO-ROOM",
    title: "A room",
    description: "Cozy",
    isPublished: "active",
    listingType: "supply",
    businessType: "roomRent",
    rentPrice: "400.00",
    deposit: "400.00",
    availableFrom: "2026-07-17T00:00:00.000Z",
    availableTo: null,
    roomFeatures: ["desk", "wifi"],
    houseFeatures: null,
    smokingAllowed: false,
    petFriendly: true,
    gender: "any",
    maxPersons: 2,
    bedrooms: 3,
    bathrooms: 1,
    matchAlertsEnabled: true,
    internalScore: "should not surface",
  };
  const api = new ListingsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify({ data: raw }) }),
  );

  const result = await api.getListing("room-1", "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { listing } = result;
  assert.deepEqual(listing.roomFeatures, ["desk", "wifi"]);
  // Null array defaults to [] so the model can safely spread/filter it.
  assert.deepEqual(listing.houseFeatures, []);
  assert.equal(listing.rentPrice, "400.00");
  assert.equal(listing.smokingAllowed, false);
  assert.equal(listing.maxPersons, 2);
  // Curated: unknown fields must not leak.
  assert.ok(!("internalScore" in listing));
});

test("getListing returns not-found when the payload has no listing", async () => {
  const api = new ListingsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify({ data: null }) }),
  );
  const result = await api.getListing("missing", "tok");
  assert.equal(result.ok, false);
});

test("getListing relays a backend error instead of throwing", async () => {
  const api = new ListingsApi(
    fakeClient({ ok: false, status: 404, body: "Not found" }),
  );
  const result = await api.getListing("x", "tok");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("createListing posts a multipart form to /listing/add", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 201, body: "{}" });
  const api = new ListingsApi(client);

  await api.createListing(
    {
      title: "Room",
      rentPrice: 400,
      propertyType: "room",
      businessType: "roomRent",
      latitude: 38.7,
      longitude: -9.1,
    },
    "tok",
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/listing/add");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.accessToken, "tok");

  const form = calls[0].opts.body as FormData;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("title"), "Room");
  assert.equal(form.get("rentPrice"), "400");
  assert.equal(form.get("businessType"), "roomRent");
  // Coordinates are serialized as strings.
  assert.equal(form.get("latitude"), "38.7");
  assert.equal(form.get("longitude"), "-9.1");
  // Optional field omitted → not appended.
  assert.equal(form.get("listingType"), null);
});

test("createListing encodes optional fields (arrays JSON-stringified, dates, booleans)", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 201, body: "{}" });
  const api = new ListingsApi(client);

  await api.createListing(
    {
      title: "The 21 One Pilot",
      rentPrice: 345,
      propertyType: "room",
      businessType: "roomRent",
      latitude: 38.7,
      longitude: -9.1,
      availableFrom: "2026-07-17",
      roomFeatures: ["desk"],
      smokingAllowed: true,
      deposit: 345,
      bedrooms: 5,
      bathrooms: 2,
    },
    "tok",
  );

  const form = calls[0].opts.body as FormData;
  assert.equal(form.get("availableFrom"), "2026-07-17");
  assert.equal(form.get("roomFeatures"), JSON.stringify(["desk"]));
  assert.equal(form.get("smokingAllowed"), "true");
  assert.equal(form.get("deposit"), "345");
  assert.equal(form.get("bedrooms"), "5");
  assert.equal(form.get("bathrooms"), "2");
});

test("updateListing sends a JSON PATCH with only the provided fields", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 200, body: "{}" });
  const api = new ListingsApi(client);

  await api.updateListing("a b/c", { rentPrice: 500, deposit: null }, "tok");

  assert.equal(calls[0].path, "/listing/a%20b%2Fc");
  assert.equal(calls[0].opts.method, "PATCH");
  assert.equal(calls[0].opts.accessToken, "tok");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");

  const sent = JSON.parse(calls[0].opts.body);
  assert.deepEqual(sent, { rentPrice: 500, deposit: null });
  // Omitted fields must not be sent (would overwrite BE state).
  assert.ok(!("title" in sent));
});

test("deleteListing issues DELETE to the url-encoded listing path", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 200, body: "" });
  const api = new ListingsApi(client);

  await api.deleteListing("a b/c", "tok");

  assert.equal(calls[0].path, "/listing/a%20b%2Fc");
  assert.equal(calls[0].opts.method, "DELETE");
  assert.equal(calls[0].opts.accessToken, "tok");
});

/**
 * Contract test — guards against BE drift. Needs only a running backend: the
 * /listing/user/:id endpoint is public, so no token is required. Skipped unless
 * IMOCERTO_API_BASE_URL (and a user id) are provided, so the default `pnpm test`
 * run stays offline. A token is optional — pass IMOCERTO_TEST_TOKEN to exercise
 * the authenticated response shape too.
 *
 *   IMOCERTO_API_BASE_URL=http://localhost:8787/api pnpm test:contract
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const userId = process.env.IMOCERTO_TEST_USER_ID;
const listingId = process.env.IMOCERTO_TEST_LISTING_ID;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;

test(
  "contract: /listing/user/:id still returns the fields the adapter reads",
  {
    skip:
      !userId || !baseUrl
        ? "set IMOCERTO_API_BASE_URL / IMOCERTO_TEST_USER_ID to run (token optional)"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request(
      `/listing/user/${encodeURIComponent(userId!)}`,
      token ? { accessToken: token } : {},
    );
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    assert.ok(Array.isArray(rows) && rows.length > 0, "no listings to check against");

    for (const field of LISTING_SOURCE_FIELDS) {
      assert.ok(
        (rows as Record<string, unknown>[]).some((r) => field in r),
        `BE response is missing "${field}" — the adapter (toSummaries) is stale`,
      );
    }
  },
);

test(
  "contract: /listing/:id still returns the fields toDetail reads",
  {
    skip:
      !listingId || !baseUrl
        ? "set IMOCERTO_API_BASE_URL / IMOCERTO_TEST_LISTING_ID (+ token) to run"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request(
      `/listing/${encodeURIComponent(listingId!)}`,
      token ? { accessToken: token } : {},
    );
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const row = (parsed?.data ?? parsed) as Record<string, unknown>;
    assert.ok(row && typeof row === "object", "no listing detail to check against");

    for (const field of LISTING_DETAIL_SOURCE_FIELDS) {
      assert.ok(
        field in row,
        `BE response is missing "${field}" — the adapter (toDetail) is stale`,
      );
    }
  },
);
