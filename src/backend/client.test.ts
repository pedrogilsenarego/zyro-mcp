import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendClient } from "./client.js";

function stubFetch(
  impl: (url: string, init: any) => Promise<Response>,
): { restore: () => void; calls: { url: string; init: any }[] } {
  const real = globalThis.fetch;
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as typeof fetch;
  return { restore: () => (globalThis.fetch = real), calls };
}

test("request GETs the joined url with no auth header when no token", async () => {
  const f = stubFetch(async () => new Response("hello", { status: 200 }));
  try {
    const res = await new BackendClient("http://api.test").request("/x");
    assert.deepEqual(res, { ok: true, status: 200, body: "hello" });
    assert.equal(f.calls[0].url, "http://api.test/x");
    assert.equal(f.calls[0].init.method, "GET");
    assert.equal(f.calls[0].init.headers.Authorization, undefined);
  } finally {
    f.restore();
  }
});

test("request sets the Bearer header, method and body", async () => {
  const f = stubFetch(async () => new Response("", { status: 201 }));
  try {
    await new BackendClient("http://api.test").request("/y", {
      method: "POST",
      accessToken: "tok",
      body: "payload",
    });
    assert.equal(f.calls[0].init.headers.Authorization, "Bearer tok");
    assert.equal(f.calls[0].init.method, "POST");
    assert.equal(f.calls[0].init.body, "payload");
  } finally {
    f.restore();
  }
});

test("request reports a non-ok status without throwing", async () => {
  const f = stubFetch(async () => new Response("nope", { status: 403 }));
  try {
    const res = await new BackendClient("http://api.test").request("/a");
    assert.deepEqual(res, { ok: false, status: 403, body: "nope" });
  } finally {
    f.restore();
  }
});

test("request wraps a network error as { ok:false, status:0 }", async () => {
  const f = stubFetch(async () => {
    throw new Error("boom");
  });
  try {
    const res = await new BackendClient("http://api.test").request("/z");
    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.match(res.body, /Network error: boom/);
  } finally {
    f.restore();
  }
});
