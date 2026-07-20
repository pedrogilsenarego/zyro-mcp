import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./tools.js";
import type { SearchApi } from "./api.js";
import type { ToolDeps } from "../deps.js";

type Registered = {
  description: string;
  shape: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, unknown>;
};

/** Fake server that records the shape + annotations of each `server.tool(...)`. */
function captureTools(): {
  server: McpServer;
  tools: Map<string, Registered>;
} {
  const tools = new Map<string, Registered>();
  const server = {
    tool(
      name: string,
      description: string,
      shape: Record<string, z.ZodTypeAny>,
      ...rest: unknown[]
    ) {
      const annotations =
        rest.length > 1 && typeof rest[0] === "object" && rest[0] !== null
          ? (rest[0] as Record<string, unknown>)
          : undefined;
      tools.set(name, { description, shape, annotations });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function registered() {
  const { server, tools } = captureTools();
  registerSearchTools(
    server,
    {} as unknown as SearchApi,
    {} as unknown as ToolDeps,
  );
  return tools;
}

function enumOptionsOf(schema: z.ZodTypeAny): readonly string[] {
  let s: any = schema;
  if (s?._def?.typeName === "ZodOptional") s = s.unwrap();
  if (s?._def?.typeName === "ZodArray") s = s.element;
  assert.equal(s?._def?.typeName, "ZodEnum", "expected an enum");
  return s.options as string[];
}

const sortedKeys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

test("registers exactly the search tools", () => {
  assert.deepEqual([...registered().keys()].sort(), ["search_listings"]);
});

test("search_listings exposes public-search fields and is read-only", () => {
  const { shape, annotations } = registered().get("search_listings")!;
  assert.deepEqual(sortedKeys(shape), [
    "businessType",
    "limit",
    "location",
    "sort",
  ]);
  assert.equal(annotations?.readOnlyHint, true);
});

test("search_listings enums accept the intended values", () => {
  const { shape } = registered().get("search_listings")!;
  assert.deepEqual(enumOptionsOf(shape.businessType), [
    "room",
    "buy",
    "rent",
    "auction",
  ]);
  assert.deepEqual(enumOptionsOf(shape.sort), [
    "newest",
    "oldest",
    "priceAsc",
    "priceDesc",
  ]);
});
