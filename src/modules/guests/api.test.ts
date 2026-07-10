import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import {
  GuestsApi,
  GUEST_SOURCE_FIELDS,
  GUEST_EVENT_SOURCE_FIELDS,
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

// Enriched rows as GET /guests returns them — more fields than we surface.
const RAW_ROWS = [
  {
    id: "guest-1",
    userId: "owner-1",
    name: "Ana",
    email: "ana@example.com",
    phone: "+351900000000",
    bio: "should not leak",
    image: "https://img",
    status: "active",
    linkedUser: null,
    linkedEvents: [
      {
        eventId: "ev-1",
        type: "lease",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-08-31T00:00:00.000Z",
        portfolioId: "prop-1",
        portfolioName: "Quarto Areeiro",
        unitId: "unit-1",
        unitName: "azul",
      },
    ],
  },
  {
    id: "guest-2",
    userId: "owner-1",
    name: "Bruno",
    email: "bruno@example.com",
    phone: null,
    status: "none",
    linkedEvents: [],
  },
];

test("listGuests maps the BE payload to curated guest summaries", async () => {
  const api = new GuestsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify({ data: RAW_ROWS }) }),
  );

  const result = await api.listGuests("token");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.guests.length, 2);

  const [ana, bruno] = result.guests;
  assert.equal(ana.name, "Ana");
  assert.equal(ana.status, "active");
  assert.equal(ana.events.length, 1);

  const [stay] = ana.events;
  assert.equal(stay.type, "lease");
  assert.equal(stay.endDate, "2026-08-31T00:00:00.000Z");
  // portfolioName/portfolioId are renamed to the property-centric shape.
  assert.equal(stay.propertyName, "Quarto Areeiro");
  assert.equal(stay.propertyId, "prop-1");
  // Room-level fields let the model name the exact room freeing up.
  assert.equal(stay.unitId, "unit-1");
  assert.equal(stay.unitName, "azul");

  // A guest with no stays surfaces an empty events list, not undefined.
  assert.equal(bruno.status, "none");
  assert.deepEqual(bruno.events, []);

  // Curated: fields we don't surface must not leak through.
  assert.ok(!("bio" in ana));
  assert.ok(!("image" in ana));
  assert.ok(!("userId" in ana));
  // Internal eventId isn't part of the summary.
  assert.ok(!("eventId" in stay));
});

test("listGuests requests /guests with the max page size and the caller's token", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [] }),
  });
  const api = new GuestsApi(client);

  await api.listGuests("tok");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/guests?limit=100");
  assert.equal(calls[0].opts.accessToken, "tok");
  // Read-only: never anything but a GET (no method override → client defaults GET).
  assert.equal(calls[0].opts.method, undefined);
});

test("listGuests tolerates a bare array payload and malformed rows", async () => {
  const api = new GuestsApi(
    fakeClient({
      ok: true,
      status: 200,
      body: JSON.stringify([{ id: "g", name: "X" }]),
    }),
  );
  const result = await api.listGuests("token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.guests.length, 1);
  // Missing linkedEvents → empty list, not a throw.
  assert.deepEqual(result.guests[0].events, []);
  assert.equal(result.guests[0].email, null);
});

test("listGuests relays a backend error instead of throwing", async () => {
  const api = new GuestsApi(
    fakeClient({ ok: false, status: 401, body: "Unauthorized" }),
  );
  const result = await api.listGuests("token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 401);
  assert.equal(result.body, "Unauthorized");
});

test("listGuests returns empty on unparseable body rather than throwing", async () => {
  const api = new GuestsApi(fakeClient({ ok: true, status: 200, body: "not json" }));
  const result = await api.listGuests("token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.guests, []);
});

/**
 * Contract test — guards against BE drift. GET /guests is authed, so this needs
 * a running backend AND a valid token; it's skipped unless both
 * IMOCERTO_API_BASE_URL and IMOCERTO_TEST_TOKEN are set, keeping `pnpm test`
 * offline. Identity comes from the token — no user id is needed.
 *
 *   IMOCERTO_API_BASE_URL=http://localhost:8787/api \
 *   IMOCERTO_TEST_TOKEN=<jwt> pnpm test:contract
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;

test(
  "contract: GET /guests still returns the fields the adapter reads",
  {
    skip:
      !token || !baseUrl
        ? "set IMOCERTO_API_BASE_URL / IMOCERTO_TEST_TOKEN to run"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request("/guests?limit=100", { accessToken: token! });
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    assert.ok(Array.isArray(rows) && rows.length > 0, "no guests to check against");

    const guestRows = rows as Record<string, unknown>[];
    for (const field of GUEST_SOURCE_FIELDS) {
      assert.ok(
        guestRows.some((r) => field in r),
        `BE response is missing guest field "${field}" — the adapter is stale`,
      );
    }

    // Event-shape drift only checkable when some guest actually has a stay.
    const withEvents = guestRows.find(
      (r) => Array.isArray(r.linkedEvents) && r.linkedEvents.length > 0,
    );
    if (!withEvents) return;
    const events = withEvents.linkedEvents as Record<string, unknown>[];
    for (const field of GUEST_EVENT_SOURCE_FIELDS) {
      assert.ok(
        events.some((e) => field in e),
        `BE linkedEvents is missing "${field}" — the adapter is stale`,
      );
    }
  },
);
