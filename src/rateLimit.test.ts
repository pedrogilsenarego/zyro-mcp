import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "./rateLimit.js";

function fakeReqRes(ip: string) {
  const req = { ip } as any;
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return { req, res };
}

test("rateLimit allows up to max, then 429s", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2 });
  let nextCalls = 0;
  const next = () => {
    nextCalls++;
  };
  const { req, res } = fakeReqRes("1.1.1.1");

  mw(req, res as any, next);
  mw(req, res as any, next);
  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 0);

  mw(req, res as any, next); // over the limit
  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers["Retry-After"]);
});

test("rateLimit buckets are per-IP", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 });
  let nextCalls = 0;
  const next = () => {
    nextCalls++;
  };
  const a = fakeReqRes("1.1.1.1");
  const b = fakeReqRes("2.2.2.2");

  mw(a.req, a.res as any, next);
  mw(b.req, b.res as any, next);
  assert.equal(nextCalls, 2);
  assert.equal(a.res.statusCode, 0);
  assert.equal(b.res.statusCode, 0);
});
