import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDeps } from "../deps.js";
import { authedHandler, text, errorText } from "../toolkit.js";
import { EventsApi } from "./api.js";
import { EVENT_TYPES } from "../../generated/contracts.js";

export function registerEventTools(
  server: McpServer,
  api: EventsApi,
  deps: ToolDeps,
): void {
  server.tool(
    "list_events",
    "List a property's portfolio events — leases, and the payable obligations " +
      "IMI ('tax_imi'), condominium and credit. Each event has { type, " +
      "startDate, endDate, propertyId, unitId, summary }, and obligation events " +
      "also carry obligation: { amount, fraction (the installment, e.g. IMI " +
      "'1/2' or condominium '3/12'), paid }. Use this to answer 'is condominium " +
      "/ IMI set and paid': an obligation is 'set' if such an event exists, and " +
      "'paid' is obligation.paid per installment. Pass portfolioId (from " +
      "list_properties) to get every event for one property; otherwise the " +
      "account-wide view defaults to today unless you pass a date range.",
    {
      portfolioId: z
        .string()
        .optional()
        .describe("Property/portfolio id (from list_properties). Recommended."),
      type: z
        .enum(EVENT_TYPES)
        .optional()
        .describe("Filter to one event type, e.g. 'condominium' or 'tax_imi'."),
      startDate: z
        .string()
        .optional()
        .describe("ISO date lower bound (only used without portfolioId)."),
      endDate: z.string().optional().describe("ISO date upper bound."),
    },
    {
      title: "List portfolio events",
      readOnlyHint: true,
      openWorldHint: false,
    },
    authedHandler(deps, async (filters: Record<string, unknown>, { token }) => {
      const result = await api.listEvents(filters, token);
      if (!result.ok) {
        return errorText(
          `Could not fetch events (status ${result.status}): ${result.body}`,
        );
      }
      return text(
        `${result.events.length} event(s):\n${JSON.stringify(
          result.events,
          null,
          2,
        )}`,
      );
    }),
  );

  server.tool(
    "mark_event_paid",
    "Mark a payable obligation event (IMI, condominium or credit) as paid. This " +
      "flips the installment's paid flag AND creates the matching payment in the " +
      "ledger in one step — so use THIS for obligations, not record_payment " +
      "(which would log a payment without settling the obligation). The eventId " +
      "comes from list_events — never guess it.\n\n" +
      "Confirm with the user which installment (see fraction) and the amount " +
      "before marking it paid. The backend rejects an event that is already " +
      "paid — relay that message. Requires edit access to the property.",
    {
      eventId: z.string().min(1).describe("The event's id (from list_events)."),
      transactionAt: z
        .string()
        .optional()
        .describe("ISO date the obligation was paid. Defaults to now."),
      note: z.string().optional(),
    },
    {
      title: "Mark obligation paid",
      readOnlyHint: false,
      // Flips the paid flag and writes a ledger payment — confirm first.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async (
        {
          eventId,
          ...body
        }: { eventId: string; transactionAt?: string; note?: string },
        { token },
      ) => {
        const result = await api.markEventPaid(eventId, body, token);
        return result.ok
          ? text(`Event ${eventId} marked as paid.\n${result.body}`)
          : errorText(
              `Marking the event paid failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );

  server.tool(
    "mark_event_unpaid",
    "Reverse a paid obligation (IMI, condominium or credit): clears the paid " +
      "flag AND deletes the payment it created in the ledger. The eventId comes " +
      "from list_events — never guess it. Confirm with the user first, since it " +
      "removes a financial record. Requires edit access to the property.",
    {
      eventId: z.string().min(1).describe("The event's id (from list_events)."),
    },
    {
      title: "Mark obligation unpaid",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    authedHandler(
      deps,
      async ({ eventId }: { eventId: string }, { token }) => {
        const result = await api.markEventUnpaid(eventId, token);
        return result.ok
          ? text(`Event ${eventId} marked as unpaid.\n${result.body}`)
          : errorText(
              `Marking the event unpaid failed (status ${result.status}): ${result.body}`,
            );
      },
    ),
  );
}
