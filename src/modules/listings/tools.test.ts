import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListingTools } from "./tools.js";
import type { ListingsApi } from "./api.js";
import type { ToolDeps } from "../deps.js";
import {
  HOUSE_FEATURE_KEYS,
  LISTING_TYPES,
  PROPERTY_TYPES,
  ROOM_FEATURE_KEYS,
} from "../../generated/contracts.js";

/**
 * The tool input shape is hand-written (NOT generated), so it can silently
 * drift from the app/BE. These tests lock the contract the model sees: the
 * exact set of exposed fields, and — for the enum-typed fields — that they
 * accept exactly the values from `generated/contracts`. Adding/removing a
 * field or diverging an enum from the generated source must be a deliberate
 * change that updates this test.
 */

type Registered = {
  description: string;
  shape: Record<string, z.ZodTypeAny>;
};

/** Fake server that records the shape passed to each `server.tool(...)` call. */
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
    ) {
      tools.set(name, { description, shape });
    },
  } as unknown as McpServer;
  return { server, tools };
}

function registered() {
  const { server, tools } = captureTools();
  registerListingTools(
    server,
    {} as unknown as ListingsApi,
    {} as unknown as ToolDeps,
  );
  return tools;
}

/** Unwrap optional / array wrappers to reach the underlying enum's options. */
function enumOptionsOf(schema: z.ZodTypeAny): readonly string[] {
  let s: any = schema;
  if (s?._def?.typeName === "ZodOptional") s = s.unwrap();
  if (s?._def?.typeName === "ZodArray") s = s.element;
  assert.equal(
    s?._def?.typeName,
    "ZodEnum",
    "expected an enum (possibly wrapped in optional/array)",
  );
  return s.options as string[];
}

const sortedKeys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

test("registers exactly the four listing tools", () => {
  const tools = registered();
  assert.deepEqual(
    [...tools.keys()].sort(),
    ["create_listing", "delete_listing", "list_listings", "update_listing"],
  );
});

test("create_listing exposes exactly the expected fields", () => {
  const { shape } = registered().get("create_listing")!;
  assert.deepEqual(sortedKeys(shape), [
    "availableFrom",
    "bathrooms",
    "bedrooms",
    "businessType",
    "deposit",
    "houseFeatures",
    "listingType",
    "location",
    "propertyType",
    "rentPrice",
    "roomFeatures",
    "smokingAllowed",
    "title",
  ]);
});

test("update_listing exposes exactly the expected fields", () => {
  const { shape } = registered().get("update_listing")!;
  assert.deepEqual(sortedKeys(shape), [
    "availableFrom",
    "bathrooms",
    "bedrooms",
    "deposit",
    "houseFeatures",
    "listingId",
    "rentPrice",
    "roomFeatures",
    "salePrice",
    "smokingAllowed",
    "title",
  ]);
});

test("delete_listing takes only a listingId", () => {
  const { shape } = registered().get("delete_listing")!;
  assert.deepEqual(sortedKeys(shape), ["listingId"]);
});

test("create_listing enum fields match the generated contracts", () => {
  const { shape } = registered().get("create_listing")!;
  assert.deepEqual(enumOptionsOf(shape.propertyType), [...PROPERTY_TYPES]);
  assert.deepEqual(enumOptionsOf(shape.listingType), [...LISTING_TYPES]);
  assert.deepEqual(enumOptionsOf(shape.roomFeatures), [...ROOM_FEATURE_KEYS]);
  assert.deepEqual(enumOptionsOf(shape.houseFeatures), [...HOUSE_FEATURE_KEYS]);
  // Deliberately narrowed: only room rental is exposed today. Widening this
  // (e.g. to sale/rent) must be a conscious change that updates this assertion.
  assert.deepEqual(enumOptionsOf(shape.businessType), ["roomRent"]);
});

test("update_listing feature fields match the generated contracts", () => {
  const { shape } = registered().get("update_listing")!;
  assert.deepEqual(enumOptionsOf(shape.roomFeatures), [...ROOM_FEATURE_KEYS]);
  assert.deepEqual(enumOptionsOf(shape.houseFeatures), [...HOUSE_FEATURE_KEYS]);
});

test("create_listing requires title/rentPrice/propertyType/businessType only", () => {
  const { shape } = registered().get("create_listing")!;
  const schema = z.object(shape);

  const minimal = {
    title: "Room",
    rentPrice: 400,
    propertyType: "room",
    businessType: "roomRent",
  };
  assert.equal(schema.safeParse(minimal).success, true);

  for (const key of Object.keys(minimal)) {
    const missing: Record<string, unknown> = { ...minimal };
    delete missing[key];
    assert.equal(
      schema.safeParse(missing).success,
      false,
      `expected "${key}" to be required`,
    );
  }
});

test("create_listing accepts numeric bedrooms/bathrooms and rejects bad values", () => {
  const { shape } = registered().get("create_listing")!;
  const schema = z.object(shape);
  const base = {
    title: "Room",
    rentPrice: 400,
    propertyType: "room",
    businessType: "roomRent",
  };

  assert.equal(
    schema.safeParse({ ...base, bedrooms: 5, bathrooms: 2 }).success,
    true,
  );
  // Optional — omitting them is valid.
  assert.equal(schema.safeParse(base).success, true);
  // Not an integer / negative / wrong type must be rejected.
  assert.equal(schema.safeParse({ ...base, bedrooms: 1.5 }).success, false);
  assert.equal(schema.safeParse({ ...base, bathrooms: -1 }).success, false);
  assert.equal(schema.safeParse({ ...base, bedrooms: "5" }).success, false);
});

test("create_listing rejects unknown feature keys", () => {
  const { shape } = registered().get("create_listing")!;
  assert.equal(
    z.object(shape).safeParse({
      title: "Room",
      rentPrice: 400,
      propertyType: "room",
      businessType: "roomRent",
      roomFeatures: ["notARealFeature"],
    }).success,
    false,
  );
});
