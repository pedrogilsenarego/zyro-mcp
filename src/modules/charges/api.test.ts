import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { ChargesApi, ChargesWriteApi } from "./api.js";

function capturingClient(body: unknown) {
  const calls: string[] = [];
  const client = {
    request: async (path: string) => {
      calls.push(path);
      return { ok: true, status: 200, body: JSON.stringify(body) };
    },
  } as unknown as BackendClient;
  return { client, calls };
}

const RAW = {
  data: [
    { id: "c1", propertyId: "p1", paymentType: "14", label: "Electricity · Home alta" },
    { id: "c2", propertyId: "p2", paymentType: "99", label: null },
  ],
};

test("listCharges passes the status, filters by property and names the type", async () => {
  const { client, calls } = capturingClient(RAW);
  const result = await new ChargesApi(client).listCharges({ status: "pending", propertyId: "p1" }, "tok");
  assert.deepEqual(calls, ["/charges?status=pending"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].type, "electricityGas");
  assert.equal(result.rows[0].label, "Electricity · Home alta");
});

test("listRecurringCharges keeps an unknown type code visible with a null name", async () => {
  const { client, calls } = capturingClient(RAW);
  const result = await new ChargesApi(client).listRecurringCharges({}, "tok");
  assert.deepEqual(calls, ["/charges/recurring"]);
  if (!result.ok) return assert.fail();
  assert.equal(result.rows[1].paymentType, "99");
  assert.equal(result.rows[1].type, null);
});

test("ChargesWriteApi patches the schedule and posts generate", async () => {
  const calls: { path: string; opts: any }[] = [];
  const client = {
    request: async (path: string, opts: any = {}) => {
      calls.push({ path, opts });
      return { ok: true, status: 200, body: "{}" };
    },
  } as unknown as BackendClient;
  const api = new ChargesWriteApi(client);
  await api.updateRecurringCharge("rc 1", { label: "Electricity and gas · Home alta" }, "tok");
  await api.generateCharges("tok");
  assert.equal(calls[0].path, "/charges/recurring/rc%201");
  assert.equal(calls[0].opts.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { label: "Electricity and gas · Home alta" });
  assert.equal(calls[1].path, "/charges/generate");
  assert.equal(calls[1].opts.method, "POST");
});
