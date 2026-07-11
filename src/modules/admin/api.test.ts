import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { AdminApi, ADMIN_LISTING_SOURCE_FIELDS } from "./api.js";

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
