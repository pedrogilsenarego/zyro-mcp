import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPaymentTools } from "./tools.js";
import type { PaymentsApi } from "./api.js";
import type { ToolDeps } from "../deps.js";
import { PAYMENT_TYPE_NAMES } from "../../generated/contracts.js";

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
  registerPaymentTools(
    server,
    {} as unknown as PaymentsApi,
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

test("registers exactly the payment tools", () => {
  assert.deepEqual(
    [...registered().keys()].sort(),
    ["list_eligible_payers", "list_payments", "record_payment"],
  );
});

test("list_payments is read-only and exposes the expected filters", () => {
  const { shape, annotations } = registered().get("list_payments")!;
  assert.deepEqual(sortedKeys(shape), [
    "endDate",
    "limit",
    "paymentType",
    "portfolioId",
    "startDate",
    "transactionType",
    "unitId",
  ]);
  assert.equal(annotations?.readOnlyHint, true);
  assert.deepEqual(enumOptionsOf(shape.paymentType), [...PAYMENT_TYPE_NAMES]);
});

test("record_payment is destructive and takes the write fields", () => {
  const { shape, annotations } = registered().get("record_payment")!;
  assert.deepEqual(sortedKeys(shape), [
    "note",
    "paidByUserId",
    "paymentType",
    "propertyId",
    "propertyUnitId",
    "transactionAt",
    "value",
  ]);
  assert.equal(annotations?.readOnlyHint, false);
  assert.equal(annotations?.destructiveHint, true);
  assert.deepEqual(enumOptionsOf(shape.paymentType), [...PAYMENT_TYPE_NAMES]);
});

test("list_eligible_payers is read-only and takes only a propertyId", () => {
  const { shape, annotations } = registered().get("list_eligible_payers")!;
  assert.deepEqual(sortedKeys(shape), ["propertyId"]);
  assert.equal(annotations?.readOnlyHint, true);
});
