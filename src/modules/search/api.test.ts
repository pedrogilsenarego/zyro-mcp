import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { SearchApi } from "./api.js";

/** Minimal fake client returning a canned response for any request. */
function fakeClient(response: {
  ok: boolean;
  status: number;
  body: string;
}): BackendClient {
  return { request: async () => response } as unknown as BackendClient;
}

/** Fake client that records the (path, opts) of every request it receives. */
function capturingClient(response: {
  ok: boolean;
  status: number;
  body: string;
}) {
  const calls: { path: string; opts: any }[] = [];
  const client = {
    request: async (path: string, opts: any = {}) => {
      calls.push({ path, opts });
      return response;
    },
  } as unknown as BackendClient;
  return { client, calls };
}

test("searchPublicListings maps params to the query string", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [], metadata: { pagination: {} } }),
  });
  const api = new SearchApi(client);

  // roomRent is the BE default and outside its typed set → must NOT be sent.
  await api.searchPublicListings(
    { businessType: "roomRent", locationName: "lisboa", limit: 5 },
    "tok",
  );
  const room = new URL(`http://x${calls[0].path}`).searchParams;
  assert.equal(room.get("businessType"), null);
  assert.equal(room.get("locationName"), "lisboa");
  assert.equal(room.get("limit"), "5");

  // A non-default businessType and sort are passed through.
  await api.searchPublicListings(
    { businessType: "sale", sortBy: "createdAt", sortDir: "desc" },
    "tok",
  );
  const sale = new URL(`http://x${calls[1].path}`).searchParams;
  assert.equal(sale.get("businessType"), "sale");
  assert.equal(sale.get("sortBy"), "createdAt");
  assert.equal(sale.get("sortDir"), "desc");
});

test("searchPublicListings parses data + pagination and reports ms", async () => {
  const body = JSON.stringify({
    data: [
      {
        realEstate: {
          id: "room-1",
          slug: "a-room",
          title: "A room",
          businessType: "roomRent",
          listingType: "supply",
          rentPrice: "400.00",
          salePrice: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          portfolioData: { id: "house-1", title: "Nice House" },
          secretField: "must not surface",
        },
        location: { name: "Lisboa", normalizedName: "lisboa" },
      },
    ],
    metadata: { pagination: { total: 12, totalListings: 34 } },
  });
  const api = new SearchApi(fakeClient({ ok: true, status: 200, body }));

  const result = await api.searchPublicListings({ locationName: "lisboa" }, "tok");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.total, 12);
  assert.equal(result.totalListings, 34);
  assert.equal(typeof result.ms, "number");
  assert.equal(result.listings.length, 1);

  const [row] = result.listings;
  assert.equal(row.id, "room-1");
  assert.equal(row.locationName, "Lisboa");
  assert.equal(row.houseTitle, "Nice House");
  assert.ok(!("secretField" in row));
});

test("searchPublicListings relays a backend error with timing", async () => {
  const api = new SearchApi(fakeClient({ ok: false, status: 500, body: "boom" }));
  const result = await api.searchPublicListings({}, "tok");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 500);
  assert.equal(result.body, "boom");
  assert.equal(typeof result.ms, "number");
});
