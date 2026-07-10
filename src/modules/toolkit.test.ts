import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolDeps } from "./deps.js";
import { text, errorText, authedHandler } from "./toolkit.js";

test("text / errorText produce the MCP result shape", () => {
  assert.deepEqual(text("hi"), { content: [{ type: "text", text: "hi" }] });
  assert.deepEqual(errorText("no"), {
    content: [{ type: "text", text: "no" }],
    isError: true,
  });
});

test("authedHandler blocks and does not call the handler without a token", async () => {
  const deps: ToolDeps = {
    getAccessToken: () => undefined,
    getUserId: () => undefined,
  };
  let called = false;
  const handler = authedHandler(deps, async () => {
    called = true;
    return text("ran");
  });

  const result = await handler({});
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Not authenticated.");
  assert.equal(called, false);
});

test("authedHandler passes token + userId when authenticated", async () => {
  const deps: ToolDeps = {
    getAccessToken: () => "jwt-123",
    getUserId: () => "user-1",
  };
  const handler = authedHandler(deps, async (_args, ctx) =>
    text(`${ctx.token}:${ctx.userId}`),
  );

  const result = await handler({});
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].text, "jwt-123:user-1");
});
