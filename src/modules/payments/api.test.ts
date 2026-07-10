import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { PaymentsApi, PAYMENT_SOURCE_FIELDS } from "./api.js";

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

const RAW_PAYMENTS = {
  data: [
    {
      id: "pay-1",
      paymentType: "5", // leaseRent
      value: "400.00",
      note: "July rent",
      transactionAt: "2026-07-01T00:00:00.000Z",
      targets: { propertyId: "prop-1", unitId: "unit-1", eventId: null },
      paidByUser: { id: "u-tenant", name: "Tenant Tim", email: "tim@x.com" },
      createdByUser: { id: "u-owner", name: "Owner Olga", email: "olga@x.com" },
      internalLedgerRef: "should not surface",
    },
  ],
  metadata: { pagination: { total: 12 } },
};

test("listPayments translates the type code to a name and curates users", async () => {
  const api = new PaymentsApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify(RAW_PAYMENTS) }),
  );
  const result = await api.listPayments({}, "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.total, 12);
  const [p] = result.payments;
  assert.equal(p.type, "leaseRent"); // code "5" → name
  assert.equal(p.value, "400.00");
  assert.equal(p.propertyId, "prop-1");
  assert.equal(p.unitId, "unit-1");
  assert.equal(p.paidBy?.name, "Tenant Tim");
  assert.equal(p.recordedBy?.name, "Owner Olga");
  // Curated: unknown raw fields must not leak, and users are trimmed to id/name/email.
  assert.ok(!("internalLedgerRef" in p));
  assert.ok(!("avatar" in (p.paidBy as object)));
});

test("listPayments maps a friendly type filter to the numeric code in the query", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [] }),
  });
  const api = new PaymentsApi(client);

  await api.listPayments(
    { paymentType: "leaseRent", transactionType: "income", portfolioId: "prop-1" },
    "tok",
  );

  const url = calls[0].path;
  assert.ok(url.startsWith("/payments?"));
  assert.ok(url.includes("paymentType=5"), `expected code 5 in ${url}`);
  assert.ok(url.includes("transactionType=income"));
  assert.ok(url.includes("portfolioId=prop-1"));
});

test("recordPayment posts the numeric code and JSON body to /payments/add", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 200, body: "{}" });
  const api = new PaymentsApi(client);

  await api.recordPayment(
    {
      paymentType: "leaseRent",
      value: 400,
      propertyUnitId: "unit-1",
      paidByUserId: "u-tenant",
      transactionAt: "2026-07-01",
    },
    "tok",
  );

  assert.equal(calls[0].path, "/payments/add");
  assert.equal(calls[0].opts.method, "POST");
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.paymentType, "5"); // name → code
  assert.equal(sent.value, 400);
  assert.equal(sent.propertyUnitId, "unit-1");
  assert.equal(sent.paidByUserId, "u-tenant");
});

test("listPayments relays a backend error instead of throwing", async () => {
  const api = new PaymentsApi(
    fakeClient({ ok: false, status: 403, body: "Forbidden" }),
  );
  const result = await api.listPayments({}, "tok");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
});

test("listEligiblePayers curates payers and keeps isCollaborator", async () => {
  const api = new PaymentsApi(
    fakeClient({
      ok: true,
      status: 200,
      body: JSON.stringify({
        data: [
          { id: "u-1", name: "Ana", email: "ana@x.com", avatar: "a.png", isCollaborator: true },
        ],
      }),
    }),
  );
  const result = await api.listEligiblePayers("prop-1", "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.payers, [
    { id: "u-1", name: "Ana", email: "ana@x.com", isCollaborator: true },
  ]);
});

/**
 * Contract test — guards against BE drift on GET /payments. Skipped unless a
 * base URL + token are provided. A user with at least one visible payment is
 * needed for the field assertions to be meaningful.
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;

test(
  "contract: /payments still returns the fields toPayments reads",
  {
    skip:
      !token || !baseUrl
        ? "set IMOCERTO_API_BASE_URL + IMOCERTO_TEST_TOKEN to run"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    const res = await client.request(`/payments?limit=1`, { accessToken: token });
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const rows = (parsed.data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return; // nothing to assert against
    for (const field of PAYMENT_SOURCE_FIELDS) {
      assert.ok(field in rows[0], `BE payment missing "${field}" — toPayments is stale`);
    }
  },
);
