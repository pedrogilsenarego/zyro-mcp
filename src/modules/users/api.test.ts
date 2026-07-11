import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../../backend/client.js";
import { UsersApi, USER_SOURCE_FIELDS } from "./api.js";

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

// Enriched rows as GET /users/search returns them — more fields than we surface.
const RAW_ROWS = [
  {
    id: "user-1",
    name: "Ana",
    email: "ana@example.com",
    image: "https://img",
    avatar: "https://avatar",
    conversationId: "conv-1",
    isOnline: true,
  },
  {
    id: "user-2",
    name: "Bruno",
    email: "bruno@example.com",
    image: null,
    avatar: null,
    conversationId: null,
    isOnline: false,
  },
];

test("findUsers maps the BE payload to curated user summaries", async () => {
  const api = new UsersApi(
    fakeClient({ ok: true, status: 200, body: JSON.stringify({ data: RAW_ROWS }) }),
  );

  const result = await api.findUsers("a", 20, "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.users.length, 2);

  const [ana] = result.users;
  assert.equal(ana.id, "user-1");
  assert.equal(ana.name, "Ana");
  assert.equal(ana.email, "ana@example.com");

  // Curated: identity-only. Nothing else leaks — no image/avatar/online/role.
  assert.ok(!("image" in ana));
  assert.ok(!("avatar" in ana));
  assert.ok(!("isOnline" in ana));
  assert.ok(!("conversationId" in ana));
  assert.ok(!("role" in ana));
});

test("findUsers requests /users/search with an encoded query and the caller's token", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: JSON.stringify({ data: [] }),
  });
  const api = new UsersApi(client);

  await api.findUsers("john doe", 10, "tok");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/users/search?q=john+doe&limit=10");
  assert.equal(calls[0].opts.accessToken, "tok");
  // Read-only: never anything but a GET (no method override → client defaults GET).
  assert.equal(calls[0].opts.method, undefined);
});

test("findUsers tolerates a bare array payload and malformed rows", async () => {
  const api = new UsersApi(
    fakeClient({
      ok: true,
      status: 200,
      body: JSON.stringify([{ id: "u" }]),
    }),
  );
  const result = await api.findUsers("u", 20, "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].id, "u");
  assert.equal(result.users[0].name, null);
  assert.equal(result.users[0].email, null);
});

test("findUsers relays a backend error instead of throwing", async () => {
  const api = new UsersApi(
    fakeClient({ ok: false, status: 401, body: "Unauthorized" }),
  );
  const result = await api.findUsers("x", 20, "token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 401);
  assert.equal(result.body, "Unauthorized");
});

test("findUsers returns empty on unparseable body rather than throwing", async () => {
  const api = new UsersApi(fakeClient({ ok: true, status: 200, body: "not json" }));
  const result = await api.findUsers("x", 20, "token");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.users, []);
});

/**
 * Contract test — guards against BE drift. GET /users/search is authed, so this
 * needs a running backend AND a valid token; it's skipped unless both
 * IMOCERTO_API_BASE_URL and IMOCERTO_TEST_TOKEN are set, keeping `pnpm test`
 * offline. Identity comes from the token — no user id is needed.
 *
 *   IMOCERTO_API_BASE_URL=http://localhost:8787/api \
 *   IMOCERTO_TEST_TOKEN=<jwt> pnpm test:contract
 */
const token = process.env.IMOCERTO_TEST_TOKEN;
const baseUrl = process.env.IMOCERTO_API_BASE_URL;

test(
  "contract: GET /users/search still returns the fields the adapter reads",
  {
    skip:
      !token || !baseUrl
        ? "set IMOCERTO_API_BASE_URL / IMOCERTO_TEST_TOKEN to run"
        : false,
  },
  async () => {
    const client = new BackendClient(baseUrl!);
    // "a" is a broad enough term to match at least one user in any real DB.
    const res = await client.request("/users/search?q=a&limit=20", {
      accessToken: token!,
    });
    assert.equal(res.ok, true, `endpoint returned status ${res.status}`);

    const parsed = JSON.parse(res.body) as { data?: unknown };
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
    assert.ok(Array.isArray(rows) && rows.length > 0, "no users to check against");

    const userRows = rows as Record<string, unknown>[];
    for (const field of USER_SOURCE_FIELDS) {
      assert.ok(
        userRows.some((r) => field in r),
        `BE response is missing user field "${field}" — the adapter is stale`,
      );
    }
  },
);
