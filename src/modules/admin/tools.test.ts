import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdminTools } from "./tools.js";
import type { AdminApi } from "./api.js";
import type { ToolDeps } from "../deps.js";

type Registered = {
  shape: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, unknown>;
};

function registered() {
  const tools = new Map<string, Registered>();
  const server = {
    tool(
      _name: string,
      _description: string,
      shape: Record<string, z.ZodTypeAny>,
      ...rest: unknown[]
    ) {
      const annotations =
        rest.length > 1 && typeof rest[0] === "object" && rest[0] !== null
          ? (rest[0] as Record<string, unknown>)
          : undefined;
      tools.set(_name, { shape, annotations });
    },
  } as unknown as McpServer;
  registerAdminTools(
    server,
    {} as unknown as AdminApi,
    {} as unknown as ToolDeps,
  );
  return tools;
}

const sortedKeys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

test("registers exactly the admin tools", () => {
  assert.deepEqual([...registered().keys()].sort(), ["admin_list_user_listings"]);
});

test("admin_list_user_listings is read-only and takes userId + optional limit", () => {
  const { shape, annotations } = registered().get("admin_list_user_listings")!;
  assert.deepEqual(sortedKeys(shape), ["limit", "userId"]);
  assert.equal(annotations?.readOnlyHint, true);
});
