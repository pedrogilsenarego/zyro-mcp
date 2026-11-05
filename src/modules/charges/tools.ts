import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import {
  ChargesApi,
  ChargesWriteApi,
  type ChargesWriteResult,
  type ListChargesResult,
  type RecurringChargeUpdate,
} from "./api.js";

const propertyIdField = z
  .string()
  .optional()
  .describe("Restrict to one property (id from list_properties).");

const reply = (what: string, result: ListChargesResult) =>
  result.ok
    ? text(`${result.rows.length} ${what}:\n${JSON.stringify(result.rows, null, 2)}`)
    : errorText(`Could not fetch ${what} (status ${result.status}): ${result.body}`);

const written = (what: string, result: ChargesWriteResult) =>
  result.ok
    ? text(`${what}: ${result.body}`)
    : errorText(`${what} failed (status ${result.status}): ${result.body}`);

export function registerChargeTools(
  server: McpServer,
  api: ChargesApi,
  writeApi: ChargesWriteApi,
  deps: ToolDeps,
): void {
  server.tool(
    "list_charges",
    "List the account's charges: the expected payments (rent, utilities, " +
      "installments) that drive the dashboard Actions list. Each row has " +
      "paymentType (code) plus type (friendly name, null if unknown), label, " +
      "periodKey, dueDate, amount, amountIsEstimate, status and " +
      "recurringChargeId (the schedule that produced it).",
    {
      status: z
        .enum(["pending", "paid", "skipped", "failed", "void"])
        .optional()
        .describe("Filter by status; 'pending' is what Actions shows."),
      propertyId: propertyIdField,
    },
    { title: "List charges", readOnlyHint: true, openWorldHint: false },
    authedHandler(deps, async (filters: Record<string, unknown>, { token }) =>
      reply("charge(s)", await api.listCharges(filters, token)),
    ),
  );

  server.tool(
    "list_recurring_charges",
    "List the account's recurring charge schedules (detected utility " +
      "schedules, rent schedules, hand-made ones). Each row has paymentType " +
      "(code) plus type (friendly name), label, amountSource, amount, " +
      "periodicity, dueDay, autoPay and active.",
    { propertyId: propertyIdField },
    { title: "List recurring charges", readOnlyHint: true, openWorldHint: false },
    authedHandler(deps, async (filters: Record<string, unknown>, { token }) =>
      reply("recurring charge(s)", await api.listRecurringCharges(filters, token)),
    ),
  );

  server.tool(
    "update_recurring_charge",
    "Edit a recurring charge schedule (id from list_recurring_charges). A new " +
      "label also renames its pending charges, a new amount on a fixed " +
      "schedule reprices them, and a new dueDay moves them.",
    {
      id: z.string().describe("Recurring charge id."),
      label: z.string().nullable().optional(),
      amount: z
        .number()
        .positive()
        .nullable()
        .optional()
        .describe("Only for fixed-amount schedules."),
      dueDay: z.number().int().min(1).max(31).optional(),
      autoPay: z.boolean().optional(),
      active: z.boolean().optional(),
    },
    {
      title: "Update recurring charge",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ id, ...updates }: { id: string } & RecurringChargeUpdate, { token }) =>
        written("Update", await writeApi.updateRecurringCharge(id, updates, token)),
    ),
  );

  server.tool(
    "generate_charges",
    "Post the account's upcoming charges from its schedules now, refresh " +
      "estimated amounts to the latest payment, and settle charges already " +
      "paid. The same job runs nightly.",
    {},
    {
      title: "Generate charges",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    authedHandler(deps, async (_args: Record<string, unknown>, { token }) =>
      written("Generate", await writeApi.generateCharges(token)),
    ),
  );
}
