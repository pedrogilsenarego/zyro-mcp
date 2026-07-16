import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdminTools } from "./tools.js";
import type { AdminApi } from "./api.js";
import type { ListingsApi } from "../listings/api.js";
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
    {} as unknown as ListingsApi,
    {} as unknown as ToolDeps,
  );
  return tools;
}

const sortedKeys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

test("registers exactly the admin tools", () => {
  assert.deepEqual(
    [...registered().keys()].sort(),
    [
      "admin_associate_listing",
      "admin_create_listing",
      "admin_create_property",
      "admin_delete_listing",
      "admin_get_listing",
      "admin_list_user_listings",
      "admin_list_user_properties",
      "admin_set_listing_status",
      "admin_update_listing",
      "admin_update_listing_images",
      "admin_update_property",
      "admin_update_property_images",
    ],
  );
});

test("admin_get_listing is read-only and takes just listingId", () => {
  const { shape, annotations } = registered().get("admin_get_listing")!;
  assert.deepEqual(sortedKeys(shape), ["listingId"]);
  assert.equal(annotations?.readOnlyHint, true);
});

test("admin_list_user_properties is read-only and takes just userId", () => {
  const { shape, annotations } = registered().get("admin_list_user_properties")!;
  assert.deepEqual(sortedKeys(shape), ["userId"]);
  assert.equal(annotations?.readOnlyHint, true);
});

test("admin_update_property is a write keyed by propertyId, no userId needed", () => {
  const { shape, annotations } = registered().get("admin_update_property")!;
  assert.equal(annotations?.readOnlyHint, false);
  // Geocodes `location` via an external service.
  assert.equal(annotations?.openWorldHint, true);
  assert.ok("propertyId" in shape);
  assert.ok("location" in shape);
  assert.ok("marketValue" in shape);
  // Owner is resolved from the property id on the backend — no user id arg.
  assert.ok(!("userId" in shape));
});

test("admin_list_user_listings is read-only and takes userId + optional limit", () => {
  const { shape, annotations } = registered().get("admin_list_user_listings")!;
  assert.deepEqual(sortedKeys(shape), ["limit", "userId"]);
  assert.equal(annotations?.readOnlyHint, true);
});

test("admin_create_listing is a write, requires userId + location, accepts images", () => {
  const { shape, annotations } = registered().get("admin_create_listing")!;
  assert.equal(annotations?.readOnlyHint, false);
  // Reaches external image URLs.
  assert.equal(annotations?.openWorldHint, true);
  for (const required of ["userId", "title", "rentPrice", "location", "images"]) {
    assert.ok(required in shape, `missing field: ${required}`);
  }
});
