import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEventTools } from "./tools.js";
import type { EventsApi } from "./api.js";
import type { ToolDeps } from "../deps.js";
import { EVENT_TYPES } from "../../generated/contracts.js";

type Registered = {
  shape: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, unknown>;
};

function registered() {
  const tools = new Map<string, Registered>();
  const server = {
    tool(
      name: string,
      _description: string,
      shape: Record<string, z.ZodTypeAny>,
      ...rest: unknown[]
    ) {
      const annotations =
        rest.length > 1 && typeof rest[0] === "object" && rest[0] !== null
          ? (rest[0] as Record<string, unknown>)
          : undefined;
      tools.set(name, { shape, annotations });
    },
  } as unknown as McpServer;
  registerEventTools(
    server,
    {} as unknown as EventsApi,
    {} as unknown as ToolDeps,
  );
  return tools;
}

const sortedKeys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

function enumOptionsOf(schema: z.ZodTypeAny): readonly string[] {
  let s: any = schema;
  if (s?._def?.typeName === "ZodOptional") s = s.unwrap();
  assert.equal(s?._def?.typeName, "ZodEnum");
  return s.options as string[];
}

test("registers exactly the event tools", () => {
  assert.deepEqual(
    [...registered().keys()].sort(),
    ["list_events", "mark_event_paid", "mark_event_unpaid"],
  );
});

test("list_events is read-only, exposes filters, and its type enum matches contracts", () => {
  const { shape, annotations } = registered().get("list_events")!;
  assert.deepEqual(sortedKeys(shape), [
    "endDate",
    "portfolioId",
    "startDate",
    "type",
  ]);
  assert.equal(annotations?.readOnlyHint, true);
  assert.deepEqual(enumOptionsOf(shape.type), [...EVENT_TYPES]);
});

test("mark_event_paid is destructive, non-idempotent, takes eventId + optional fields", () => {
  const { shape, annotations } = registered().get("mark_event_paid")!;
  assert.deepEqual(sortedKeys(shape), ["eventId", "note", "transactionAt"]);
  assert.equal(annotations?.readOnlyHint, false);
  assert.equal(annotations?.destructiveHint, true);
  assert.equal(annotations?.idempotentHint, false);
});

test("mark_event_unpaid is destructive and takes only an eventId", () => {
  const { shape, annotations } = registered().get("mark_event_unpaid")!;
  assert.deepEqual(sortedKeys(shape), ["eventId"]);
  assert.equal(annotations?.destructiveHint, true);
});
