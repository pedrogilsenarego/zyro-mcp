import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import {
  PropertiesApi,
  buildPropertyForm,
  PROPERTY_ROOMS_BUSINESS_TYPE,
  PROPERTY_ROOM_UNIT_TYPE,
  PROPERTY_SOURCE_FIELDS,
  PROPERTY_UNIT_SOURCE_FIELDS,
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

// Nested rows as GET /property returns them: property → businesses[] → units[].
const RAW_ROWS = [
  {
    id: "prop-1",
    title: "Casa Areeiro",
    description: "should not leak",
    bedrooms: 3,
    bathrooms: 2,
    generatesIncome: true,
    imageUrls: ["x"],
    businesses: [
      {
        id: "biz-1",
        businessType: 2,
        units: [
          { id: "unit-1", title: "Room A", unitType: 1, realEstateId: "re-1" },
          { id: "unit-2", title: "Room B", unitType: 1 },
        ],
      },
      { id: "biz-2", businessType: 1, units: [] },
    ],
  },
  {
    id: "prop-2",
    title: "Personal flat",
    bedrooms: null,
    bathrooms: null,
    generatesIncome: false,
    businesses: [],
  },
];

test("listProperties flattens units across businesses into a curated shape", async () => {
  const api = new PropertiesApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify({ data: RAW_ROWS }) }),
  );

  const result = await api.listProperties("token");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.properties.length, 2);

  const [casa, flat] = result.properties;
  assert.equal(casa.title, "Casa Areeiro");
  assert.equal(casa.bedrooms, 3);
  assert.equal(casa.generatesIncome, true);

  // Units from both businesses flatten into one list; empty business contributes none.
  assert.equal(casa.units.length, 2);
  assert.deepEqual(
    casa.units.map((u) => u.id),
    ["unit-1", "unit-2"],
  );
  assert.equal(casa.units[0].title, "Room A");
  assert.equal(casa.units[0].unitType, 1);

  // A property with no businesses → empty units, not undefined.
  assert.deepEqual(flat.units, []);
  assert.equal(flat.generatesIncome, false);

  // Curated: fields we don't surface must not leak through.
  assert.ok(!("description" in casa));
  assert.ok(!("imageUrls" in casa));
  // Nested unit is trimmed too.
  assert.ok(!("realEstateId" in casa.units[0]));
});

test("listProperties requests /property with the max page size and the caller's token", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [] }),
  });
  const api = new PropertiesApi(client);

  await api.listProperties("tok");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/property?limit=1000");
  assert.equal(calls[0].opts.accessToken, "tok");
  assert.equal(calls[0].opts.method, undefined);
});

test("listProperties tolerates a bare array payload and missing businesses", async () => {
  const api = new PropertiesApi(
    fakeClient({
      ok: true,
      status: 200,
      body: JSON.stringify([{ id: "p", title: "T" }]),
    }),
  );
  const result = await api.listProperties("token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.properties.length, 1);
  assert.deepEqual(result.properties[0].units, []);
  assert.equal(result.properties[0].bedrooms, null);
});

test("listProperties relays a backend error instead of throwing", async () => {
  const api = new PropertiesApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.listProperties("token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  assert.equal(result.body, "Forbidden");
});

test("listProperties returns empty on unparseable body rather than throwing", async () => {
  const api = new PropertiesApi(fakeClient({ ok: true, status: 200, body: "nope" }));
  const result = await api.listProperties("token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.properties, []);
});

test("updateProperty PUTs only the passed fields as JSON to /property/:id", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: { id: "prop-1" } }),
  });
  const api = new PropertiesApi(client);

  const result = await api.updateProperty(
    "prop-1",
    { marketValue: 250000, latitude: 38.7, longitude: -9.1 },
    "tok",
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/property/prop-1");
  assert.equal(calls[0].opts.method, "PUT");
  assert.equal(calls[0].opts.accessToken, "tok");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    marketValue: 250000,
    latitude: 38.7,
    longitude: -9.1,
  });
});

test("updateProperty relays a backend permission error instead of throwing", async () => {
  const api = new PropertiesApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.updateProperty("prop-1", { title: "X" }, "tok");
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.body, "Forbidden");
});

test("buildPropertyForm encodes rooms as a single Rooms business with room units", async () => {
  const form = buildPropertyForm({
    title: "Casa Passos Manuel",
    latitude: 38.72,
    longitude: -9.13,
    marketValue: 400000,
    generatesIncome: true,
    houseFeatures: ["elevator", "wifi"],
    rooms: ["Room 1", "Room 2"],
  });

  assert.equal(form.get("title"), "Casa Passos Manuel");
  assert.equal(form.get("latitude"), "38.72");
  assert.equal(form.get("longitude"), "-9.13");
  assert.equal(form.get("marketValue"), "400000");
  assert.equal(form.get("generatesIncome"), "true");
  assert.deepEqual(JSON.parse(String(form.get("houseFeatures"))), [
    "elevator",
    "wifi",
  ]);

  const businesses = JSON.parse(String(form.get("businesses")));
  assert.deepEqual(businesses, [
    {
      businessType: PROPERTY_ROOMS_BUSINESS_TYPE,
      units: [
        { title: "Room 1", unitType: PROPERTY_ROOM_UNIT_TYPE },
        { title: "Room 2", unitType: PROPERTY_ROOM_UNIT_TYPE },
      ],
    },
  ]);
});

test("buildPropertyForm still sends one empty Rooms business when no rooms given", async () => {
  const form = buildPropertyForm({ title: "Empty House" });
  // Optional scalars are omitted entirely rather than sent as "undefined".
  assert.equal(form.get("latitude"), null);
  assert.equal(form.get("marketValue"), null);
  const businesses = JSON.parse(String(form.get("businesses")));
  assert.deepEqual(businesses, [
    { businessType: PROPERTY_ROOMS_BUSINESS_TYPE, units: [] },
  ]);
});

test("createProperty POSTs the multipart form to /property/add with the caller's token", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: { id: "prop-9" } }),
  });
  const api = new PropertiesApi(client);

  const result = await api.createProperty(
    { title: "Casa X", rooms: ["Room 1"] },
    "tok",
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/property/add");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.accessToken, "tok");
  assert.ok(calls[0].opts.body instanceof FormData);
  assert.equal((calls[0].opts.body as FormData).get("title"), "Casa X");
});

test("createProperty relays a backend error instead of throwing", async () => {
  const api = new PropertiesApi(
    fakeClient({ ok: false, status: 400, body: "At least one business is required" }),
  );
  const result = await api.createProperty({ title: "X" }, "tok");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

/**
 * Contract test — guards against BE drift. GET /property is authed, so this
 * needs a running backend AND a valid token; skipped unless both
 * IMOCERTO_API_BASE_URL and IMOCERTO_TEST_TOKEN are set. Identity comes from the
 * token — no user id needed.
 *
 *   IMOCERTO_API_BASE_URL=http://localhost:8787/api \
 *   IMOCERTO_TEST_TOKEN=<jwt> pnpm test:contract
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;

test(
  "contract: GET /property still returns the fields the adapter reads",
  {
    skip:
      !token || !baseUrl
        ? "set IMOCERTO_API_BASE_URL / IMOCERTO_TEST_TOKEN to run"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request("/property?limit=1000", {
      accessToken: token!,
    });
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    assert.ok(
      Array.isArray(rows) && rows.length > 0,
      "no properties to check against",
    );

    const propRows = rows as Record<string, unknown>[];
    for (const field of PROPERTY_SOURCE_FIELDS) {
      assert.ok(
        propRows.some((r) => field in r),
        `BE response is missing property field "${field}" — the adapter is stale`,
      );
    }

    // Unit-shape drift only checkable when some property actually has a unit.
    let unit: Record<string, unknown> | undefined;
    for (const p of propRows) {
      const businesses = Array.isArray(p.businesses) ? p.businesses : [];
      for (const b of businesses as Record<string, unknown>[]) {
        const units = Array.isArray(b.units) ? b.units : [];
        if (units.length > 0) {
          unit = units[0] as Record<string, unknown>;
          break;
        }
      }
      if (unit) break;
    }
    if (!unit) return;
    for (const field of PROPERTY_UNIT_SOURCE_FIELDS) {
      assert.ok(field in unit, `BE unit is missing "${field}" — the adapter is stale`);
    }
  },
);
