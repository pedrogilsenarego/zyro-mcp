import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { ChargesApi, type ListChargesResult } from "./api.js";

const propertyIdField = z
  .string()
  .optional()
  .describe("Restrict to one property (id from list_properties).");

const reply = (what: string, result: ListChargesResult) =>
  result.ok
    ? text(`${result.rows.length} ${what}:\n${JSON.stringify(result.rows, null, 2)}`)
    : errorText(`Could not fetch ${what} (status ${result.status}): ${result.body}`);

export function registerChargeTools(server: McpServer, api: ChargesApi, deps: ToolDeps): void {
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
}
