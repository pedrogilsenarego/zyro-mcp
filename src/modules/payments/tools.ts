import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { PaymentsApi } from "./api.js";
import { PAYMENT_TYPE_NAMES } from "../../generated/contracts.js";

const paymentTypeField = z
  .enum(PAYMENT_TYPE_NAMES)
  .describe(
    "Payment type. Rent received from a tenant is 'leaseRent'. Utilities are " +
      "electricity/water/internet/gas; others: house, cleaning, credit, taxes, " +
      "condominium, management, adjustment, constructionLabors.",
  );

export function registerPaymentTools(
  server: McpServer,
  api: PaymentsApi,
  deps: ToolDeps,
): void {
  server.tool(
    "list_payments",
    "List payments/transactions the authenticated user can see across their " +
      "own and shared portfolios. Each row has: type (e.g. 'leaseRent'), value " +
      "(signed — positive = income like rent received, negative = expense), " +
      "transactionAt, note, propertyId/unitId, paidBy (who actually paid) and " +
      "recordedBy (who logged it). To answer 'who paid the rent', filter " +
      "paymentType='leaseRent' and read paidBy. Filter by portfolio, unit, " +
      "type, income/expense, or a date range.",
    {
      portfolioId: z
        .string()
        .optional()
        .describe("Restrict to one portfolio (id from list_properties)."),
      unitId: z.string().optional().describe("Restrict to one unit/room."),
      paymentType: paymentTypeField.optional(),
      transactionType: z
        .enum(["income", "expense"])
        .optional()
        .describe("income = money in (rent), expense = money out."),
      startDate: z
        .string()
        .optional()
        .describe("ISO date lower bound on transactionAt, e.g. '2026-07-01'."),
      endDate: z.string().optional().describe("ISO date upper bound."),
      limit: z.number().int().positive().max(200).optional(),
    },
    {
      title: "List payments",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(deps, async (filters: Record<string, unknown>, { token }) => {
      const result = await api.listPayments(filters, token);
      if (!result.ok) {
        return errorText(
          `Could not fetch payments (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.payments.length} of ${result.total} payment(s):\n${JSON.stringify(
          result.payments,
          null,
          2,
        )}`,
      );
    }),
  );

  server.tool(
    "list_eligible_payers",
    "List the people who can be recorded as the payer on a property's payments " +
      "(its collaborators and the user's connections), each with id, name, " +
      "email and isCollaborator. Use it to resolve a person named by the user " +
      "into the paidByUserId that record_payment needs — never guess an id.",
    {
      propertyId: z
        .string()
        .min(1)
        .describe("The property/portfolio id (from list_properties)."),
    },
    {
      title: "List eligible payers",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ propertyId }: { propertyId: string }, { token }) => {
        const result = await api.listEligiblePayers(propertyId, token);
        if (!result.ok) {
          return errorText(
            `Could not fetch eligible payers (status ${result.status}): ${result.body}`,
          );
        }
        return text(JSON.stringify(result.payers, null, 2));
      },
    ),
  );

  server.tool(
    "record_payment",
    "Record a payment/transaction against a property or unit — this is how you " +
      "'mark rent as paid' (paymentType 'leaseRent', a positive value). The " +
      "payment must link to a property (propertyId) or a unit (propertyUnitId); " +
      "one of the two is required. value is signed: positive for income (rent " +
      "received), negative for an expense.\n\n" +
      "Before recording, confirm the details with the user — amount, type, " +
      "which property/unit, the date, and who paid — because this writes to the " +
      "account's financial records and updates monthly reports. To attribute a " +
      "payer, resolve their name to paidByUserId via list_eligible_payers " +
      "first; never guess an id. Recording requires edit access to the " +
      "property; relay any permission error from the backend verbatim.",
    {
      paymentType: paymentTypeField,
      value: z
        .number()
        .describe("Amount. Positive = income (rent received), negative = expense."),
      propertyId: z
        .string()
        .optional()
        .describe("Property/portfolio id. Required unless propertyUnitId is set."),
      propertyUnitId: z
        .string()
        .optional()
        .describe("Unit/room id. Required unless propertyId is set."),
      paidByUserId: z
        .string()
        .optional()
        .describe("Who paid — an id from list_eligible_payers, not a name."),
      transactionAt: z
        .string()
        .optional()
        .describe("ISO date of the payment. Defaults to now if omitted."),
      note: z.string().optional(),
    },
    {
      title: "Record payment",
      readOnlyHint: false,
      // Writes an immutable-ish financial record and moves monthly totals.
      // Flagged destructive so clients confirm before recording.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async (
        input: {
          propertyId?: string;
          propertyUnitId?: string;
        } & Record<string, unknown>,
        { token },
      ) => {
        if (!input.propertyId && !input.propertyUnitId) {
          return errorText(
            "A payment needs a target: pass propertyId or propertyUnitId.",
          );
        }
        const result = await api.recordPayment(input as any, token);
        return result.ok
          ? text(`Payment recorded.\n${result.body}`)
          : errorText(
              `Recording the payment failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );
}
