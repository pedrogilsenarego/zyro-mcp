import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "../backend/client.js";
import { isAdminRole, resolveRole } from "./identity.js";

/** Fake client that records calls and returns a canned /me response. */
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

const meBody = (role: string) => JSON.stringify({ user: { id: "u", role } });

test("isAdminRole is true only for admin/imocerto", () => {
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("imocerto"), true);
  assert.equal(isAdminRole("manager"), false);
  assert.equal(isAdminRole("user"), false);
  assert.equal(isAdminRole(null), false);
  assert.equal(isAdminRole(undefined), false);
});

test("resolveRole returns null without a token and never calls the backend", async () => {
  const { client, calls } = capturingClient({ ok: true, status: 200, body: meBody("admin") });
  const role = await resolveRole(client, undefined, "u1");
  assert.equal(role, null);
  assert.equal(calls.length, 0);
});

test("resolveRole reads user.role from /me", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: meBody("imocerto"),
  });
  // Unique userId so this test doesn't share the module cache with others.
  const role = await resolveRole(client, "tok", "user-reads-role");
  assert.equal(role, "imocerto");
  assert.equal(calls[0].path, "/users/me");
  assert.equal(calls[0].opts.accessToken, "tok");
});

test("resolveRole caches per user — a second call within TTL skips /me", async () => {
  const { client, calls } = capturingClient({
    ok: true,
    status: 200,
    body: meBody("admin"),
  });
  const first = await resolveRole(client, "tok", "user-cached");
  const second = await resolveRole(client, "tok", "user-cached");
  assert.equal(first, "admin");
  assert.equal(second, "admin");
  assert.equal(calls.length, 1, "second call should hit the cache, not the backend");
});

test("resolveRole degrades to null (not admin) when /me fails", async () => {
  const { client } = capturingClient({ ok: false, status: 401, body: "Unauthorized" });
  const role = await resolveRole(client, "tok", "user-me-fails");
  assert.equal(role, null);
  assert.equal(isAdminRole(role), false);
});
