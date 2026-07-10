import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { EventsApi, EVENT_SOURCE_FIELDS } from "./api.js";

function fakeClient(response: { ok: boolean; status: number; body: string }) {
  return { request: async () => response } as unknown as BackendClient;
}

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

// by-portfolio returns { events: [...] }; each obligation nests its sub-record.
const BY_PORTFOLIO = {
  portfolioId: "prop-1",
  events: [
    {
      id: "ev-imi",
      type: "tax_imi",
      portfolioId: "prop-1",
      unitId: null,
      startDate: "2026-04-30T00:00:00.000Z",
      endDate: null,
      summary: "IMI 2026",
      description: null,
      imi: { id: "imi-1", amount: "120.00", fraction: "1/2", paid: false },
      condominium: null,
      credit: null,
      lease: null,
    },
    {
      id: "ev-lease",
      type: "lease",
      portfolioId: "prop-1",
      unitId: "unit-1",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-12-31T00:00:00.000Z",
      summary: null,
      description: null,
      imi: null,
      condominium: null,
      credit: null,
      lease: { id: "l-1" },
    },
  ],
  count: 2,
};

test("listEvents flattens obligation sub-records and leaves lease obligation null", async () => {
  const api = new EventsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify(BY_PORTFOLIO) }),
  );
  const result = await api.listEvents({ portfolioId: "prop-1" }, "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const imi = result.events.find((e) => e.id === "ev-imi")!;
  assert.deepEqual(imi.obligation, {
    amount: "120.00",
    fraction: "1/2",
    paid: false,
  });
  const lease = result.events.find((e) => e.id === "ev-lease")!;
  assert.equal(lease.obligation, null);
});

test("listEvents with a portfolioId hits the by-portfolio endpoint (no date window)", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify(BY_PORTFOLIO),
  });
  const api = new EventsApi(client);
  await api.listEvents({ portfolioId: "prop 1/x" }, "tok");
  assert.equal(calls[0].path, "/portfolio-events/portfolio/prop%201%2Fx");
});

test("listEvents without a portfolioId uses the account-wide endpoint + date range", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [] }),
  });
  const api = new EventsApi(client);
  await api.listEvents({ startDate: "2026-01-01", endDate: "2026-12-31" }, "tok");
  const url = calls[0].path;
  assert.ok(url.startsWith("/portfolio-events?"), url);
  assert.ok(url.includes("startDate=2026-01-01"));
  assert.ok(url.includes("endDate=2026-12-31"));
});

test("listEvents filters by type client-side", async () => {
  const api = new EventsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify(BY_PORTFOLIO) }),
  );
  const result = await api.listEvents(
    { portfolioId: "prop-1", type: "tax_imi" },
    "tok",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "tax_imi");
});

test("markEventPaid POSTs to the mark-paid endpoint with the body", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 200, body: "{}" });
  const api = new EventsApi(client);
  await api.markEventPaid("ev-imi", { transactionAt: "2026-05-01" }, "tok");
  assert.equal(calls[0].path, "/portfolio-events/ev-imi/mark-paid");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { transactionAt: "2026-05-01" });
});

test("markEventUnpaid POSTs to the mark-unpaid endpoint", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 200, body: "{}" });
  const api = new EventsApi(client);
  await api.markEventUnpaid("ev-imi", "tok");
  assert.equal(calls[0].path, "/portfolio-events/ev-imi/mark-unpaid");
  assert.equal(calls[0].opts.method, "POST");
});

test("listEvents relays a backend error instead of throwing", async () => {
  const api = new EventsApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.listEvents({ portfolioId: "p" }, "tok");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
});

/**
 * Contract test — guards against BE drift on GET /portfolio-events/portfolio/:id.
 * Skipped unless a base URL + token + portfolio id are provided.
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;
const portfolioId = process.env.IMOCERTO_TEST_PORTFOLIO_ID;

test(
  "contract: /portfolio-events/portfolio/:id still returns the fields toEvents reads",
  {
    skip:
      !token || !baseUrl || !portfolioId
        ? "set IMOCERTO_API_BASE_URL + IMOCERTO_TEST_TOKEN + IMOCERTO_TEST_PORTFOLIO_ID"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request(
      `/portfolio-events/portfolio/${encodeURIComponent(portfolioId!)}`,
      { accessToken: token },
    );
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);
    const parsed = JSON.parse(res.body) as { events?: Record<string, unknown>[] };
    const rows = parsed.events ?? [];
    if (rows.length === 0) return;
    for (const field of EVENT_SOURCE_FIELDS) {
      assert.ok(field in rows[0], `BE event missing "${field}" — toEvents is stale`);
    }
  },
);
