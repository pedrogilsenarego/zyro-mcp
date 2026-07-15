import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { AdminApi, ADMIN_LISTING_SOURCE_FIELDS, downloadImages } from "./api.js";

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

// Rows as GET /admin/listings returns them, wrapped in the pagination envelope.
const RAW_BODY = JSON.stringify({
  data: [
    {
      id: "l-1",
      title: "Quarto Areeiro",
      listingType: "supply",
      isPublished: "draft",
      createdAt: "2026-01-01T00:00:00.000Z",
      ownerId: "owner-1",
      ownerName: "Ana",
      ownerEmail: "ana@example.com",
      portfolioTitle: "Areeiro",
      unitTitle: "azul",
    },
    {
      id: "l-2",
      title: "Studio Porto",
      listingType: "supply",
      isPublished: "active",
      createdAt: "2026-02-01T00:00:00.000Z",
      ownerId: "owner-1",
      ownerName: "Ana",
      ownerEmail: "ana@example.com",
      portfolioTitle: null,
      unitTitle: null,
    },
  ],
  pagination: { page: 1, limit: 50, total: 7 },
});

test("listUserListings maps rows and reads the pagination total", async () => {
  const api = new AdminApi(fakeClient({ ok: true, status: 200, body: RAW_BODY }));

  const result = await api.listUserListings("owner-1", 50, "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.total, 7);
  assert.equal(result.listings.length, 2);

  const [draft] = result.listings;
  assert.equal(draft.id, "l-1");
  assert.equal(draft.title, "Quarto Areeiro");
  // isPublished is surfaced as `status` — admins see non-active ones.
  assert.equal(draft.status, "draft");
  assert.equal(draft.ownerEmail, "ana@example.com");
  assert.equal(draft.unitTitle, "azul");
});

test("listUserListings requests /admin/listings scoped to the userId with the token", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [], pagination: { total: 0 } }),
  });
  const api = new AdminApi(client);

  await api.listUserListings("owner-1", 25, "tok");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/admin/listings?userId=owner-1&limit=25");
  assert.equal(calls[0].opts.accessToken, "tok");
  // Read-only: never anything but a GET.
  assert.equal(calls[0].opts.method, undefined);
});

test("listUserListings relays a 403 (non-admin) instead of throwing", async () => {
  const api = new AdminApi(
    fakeClient({ ok: false, status: 403, body: '{"error":"Forbidden"}' }),
  );
  const result = await api.listUserListings("owner-1", 50, "token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  assert.match(result.body, /Forbidden/);
});

test("listUserListings tolerates a bare array and falls back total to length", async () => {
  const api = new AdminApi(
    fakeClient({
      ok: true,
      status: 200,
      body: JSON.stringify([{ id: "l-9", isPublished: "inactive" }]),
    }),
  );
  const result = await api.listUserListings("u", 50, "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.total, 1);
  assert.equal(result.listings[0].status, "inactive");
  assert.equal(result.listings[0].title, null);
});

test("listUserListings returns empty on unparseable body rather than throwing", async () => {
  const api = new AdminApi(fakeClient({ ok: true, status: 200, body: "not json" }));
  const result = await api.listUserListings("u", 50, "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.listings, []);
  assert.equal(result.total, 0);
});

test("createListingForUser POSTs the owner id + fields as multipart to /admin/listings", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: '{"data":{"id":"new-1"}}',
  });
  const api = new AdminApi(client);

  const result = await api.createListingForUser(
    "owner-9",
    {
      title: "Quarto Erasmus",
      rentPrice: 450,
      propertyType: "room",
      businessType: "roomRent",
      description: "Bright room near the university.",
      roomFeatures: ["desk", "wardrobe"],
      listingType: "supply",
      latitude: 38.7,
      longitude: -9.1,
    },
    [],
    "admin-tok",
  );

  assert.equal(result.ok, true);
  assert.equal(result.imagesAttached, 0);
  assert.deepEqual(result.imagesFailed, []);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/admin/listings");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.accessToken, "admin-tok");

  const form = calls[0].opts.body as FormData;
  // Owner comes through as the `userId` field the BE reads.
  assert.equal(form.get("userId"), "owner-9");
  assert.equal(form.get("title"), "Quarto Erasmus");
  assert.equal(form.get("rentPrice"), "450");
  assert.equal(form.get("description"), "Bright room near the university.");
  // Arrays are JSON-stringified for the multipart form.
  assert.equal(form.get("roomFeatures"), '["desk","wardrobe"]');
});

test("createListingForUser attaches fetched images and reports failures", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: '{"data":{"id":"new-2"}}',
  });
  const api = new AdminApi(client);

  const fakeFetch = async (url: string): Promise<Response> =>
    url.includes("good")
      ? new Response(new Blob([new Uint8Array([1, 2, 3])]), {
          headers: { "content-type": "image/jpeg" },
        })
      : new Response("nope", { status: 404 });

  const result = await api.createListingForUser(
    "owner-9",
    {
      title: "Room",
      rentPrice: 400,
      propertyType: "room",
      businessType: "roomRent",
      listingType: "supply",
      latitude: 38.7,
      longitude: -9.1,
    },
    ["https://host/good.jpg", "https://host/bad.jpg"],
    "admin-tok",
    fakeFetch,
  );

  assert.equal(result.imagesAttached, 1);
  assert.deepEqual(result.imagesFailed, ["https://host/bad.jpg"]);

  const form = calls[0].opts.body as FormData;
  assert.equal(form.getAll("images").length, 1);
});

test("downloadImages skips non-image content types", async () => {
  const fakeFetch = async (url: string): Promise<Response> =>
    url.includes("html")
      ? new Response("<html>", { headers: { "content-type": "text/html" } })
      : new Response(new Blob([new Uint8Array([9])]), {
          headers: { "content-type": "image/png" },
        });

  const { files, failed } = await downloadImages(
    ["https://host/page.html", "https://host/pic.png"],
    fakeFetch,
  );

  assert.equal(files.length, 1);
  assert.equal(files[0].filename, "image-2.png");
  assert.deepEqual(failed, ["https://host/page.html"]);
});

test("listUserProperties curates coords + derives hasLocation", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({
      data: [
        { id: "p1", title: "With loc", latitude: "38.7", longitude: "-9.1", marketValue: "250000" },
        { id: "p2", title: "No loc", latitude: null, longitude: null },
      ],
    }),
  });
  const api = new AdminApi(client);

  const result = await api.listUserProperties("user-1", "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(calls[0].path, "/admin/users/user-1/portfolios");
  assert.equal(calls[0].opts.method, undefined);
  assert.deepEqual(result.properties, [
    {
      id: "p1",
      title: "With loc",
      latitude: "38.7",
      longitude: "-9.1",
      marketValue: "250000",
      hasLocation: true,
      units: [],
    },
    {
      id: "p2",
      title: "No loc",
      latitude: null,
      longitude: null,
      marketValue: null,
      hasLocation: false,
      units: [],
    },
  ]);
});

test("listUserProperties flattens units and maps realEstateId → listingId", async () => {
  const api = new AdminApi(
    fakeClient({
      ok: true,
      status: 200,
      body: JSON.stringify({
        data: [
          {
            id: "p1",
            title: "Flat H",
            businesses: [
              {
                units: [
                  { id: "u1", title: "Room 1", realEstateId: "listing-1" },
                  { id: "u2", title: "Room 2", realEstateId: null },
                ],
              },
            ],
          },
        ],
      }),
    }),
  );

  const result = await api.listUserProperties("user-1", "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.properties[0].units, [
    { id: "u1", title: "Room 1", listingId: "listing-1" },
    { id: "u2", title: "Room 2", listingId: null },
  ]);
});

test("listUserProperties relays a 403 (non-admin) instead of throwing", async () => {
  const api = new AdminApi(fakeClient({ ok: false, status: 403, body: "Forbidden" }));
  const result = await api.listUserProperties("user-1", "tok");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
});

test("updatePropertyForUser PUTs the fields as JSON to /admin/portfolios/:id", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: { id: "prop-9" } }),
  });
  const api = new AdminApi(client);

  const result = await api.updatePropertyForUser(
    "prop-9",
    { latitude: 38.72, longitude: -9.14, marketValue: 300000 },
    "admin-tok",
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/admin/portfolios/prop-9");
  assert.equal(calls[0].opts.method, "PUT");
  assert.equal(calls[0].opts.accessToken, "admin-tok");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    latitude: 38.72,
    longitude: -9.14,
    marketValue: 300000,
  });
});

test("createPropertyForUser POSTs the owner id + property form to /admin/portfolios", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: { id: "prop-new" } }),
  });
  const api = new AdminApi(client);

  const result = await api.createPropertyForUser(
    "owner-7",
    { title: "Casa Passos Manuel", rooms: ["Room 1", "Room 2"] },
    "admin-tok",
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/admin/portfolios");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.accessToken, "admin-tok");
  assert.ok(calls[0].opts.body instanceof FormData);

  const form = calls[0].opts.body as FormData;
  assert.equal(form.get("userId"), "owner-7");
  assert.equal(form.get("title"), "Casa Passos Manuel");
  const businesses = JSON.parse(String(form.get("businesses")));
  assert.equal(businesses[0].units.length, 2);
});

test("createPropertyForUser relays a 403 (non-admin) instead of throwing", async () => {
  const api = new AdminApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.createPropertyForUser(
    "owner-7",
    { title: "X" },
    "tok",
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.body, "Forbidden");
});

test("updatePropertyForUser relays a 403 (non-admin) instead of throwing", async () => {
  const api = new AdminApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.updatePropertyForUser("prop-9", { title: "X" }, "tok");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.body, "Forbidden");
});

/**
 * Contract test — guards against BE drift. GET /admin/listings is admin-gated,
 * so it needs a running backend AND an ADMIN token. Skipped unless
 * IMOCERTO_API_BASE_URL, IMOCERTO_TEST_TOKEN and IMOCERTO_TEST_USER_ID are set.
 *
 *   IMOCERTO_API_BASE_URL=http://localhost:8787/api \
 *   IMOCERTO_TEST_TOKEN=<admin-jwt> IMOCERTO_TEST_USER_ID=<user-id> pnpm test:contract
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;
const testUserId = process.env.IMOCERTO_TEST_USER_ID;

test(
  "contract: GET /admin/listings still returns the fields the adapter reads",
  {
    skip:
      !token || !baseUrl || !testUserId
        ? "set IMOCERTO_API_BASE_URL / IMOCERTO_TEST_TOKEN / IMOCERTO_TEST_USER_ID (admin) to run"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request(
      `/admin/listings?userId=${encodeURIComponent(testUserId!)}&limit=20`,
      { accessToken: token! },
    );
    assert.equal(
      res.ok,
      true,
      `endpoint returned status ${res.status} (is the token an admin?)`,
    );

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    assert.ok(Array.isArray(rows) && rows.length > 0, "no listings to check against");

    const listingRows = rows as Record<string, unknown>[];
    for (const field of ADMIN_LISTING_SOURCE_FIELDS) {
      assert.ok(
        listingRows.some((r) => field in r),
        `BE response is missing listing field "${field}" — the adapter is stale`,
      );
    }
  },
);
