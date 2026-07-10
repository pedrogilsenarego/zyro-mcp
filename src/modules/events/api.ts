import type { BackendClient, BackendResult } from "../../backend/client.js";
import type { EventType } from "../../generated/contracts.js";

// Raw BE fields toEvent reads off each row (GET /portfolio-events*). The
// contract test asserts they still exist so curation can't silently drift.
export const EVENT_SOURCE_FIELDS = [
  "id",
  "type",
  "portfolioId",
  "unitId",
  "startDate",
  "endDate",
  "summary",
  "description",
  "imi",
  "condominium",
  "credit",
] as const;

// Event types that are payable obligations, each backed by a sub-record
// carrying { amount, fraction, paid }. Keyed by the sub-record property name
// the BE nests it under.
const OBLIGATION_SUBRECORD: Partial<Record<EventType, "imi" | "condominium" | "credit">> = {
  tax_imi: "imi",
  condominium: "condominium",
  credit: "credit",
};

export type Obligation = {
  amount: string | null;
  // Installment label, e.g. IMI "1/2" or condominium "3/12".
  fraction: string | null;
  paid: boolean;
};

export type EventSummary = {
  id: string;
  type: string | null;
  startDate: string | null;
  endDate: string | null;
  propertyId: string | null;
  unitId: string | null;
  summary: string | null;
  description: string | null;
  // Present only for obligation events (tax_imi / condominium / credit).
  // null for lease / airbnb_reservation / labors.
  obligation: Obligation | null;
};

export type ListEventsResult =
  | { ok: true; status: number; events: EventSummary[] }
  | { ok: false; status: number; body: string };

export type EventFilters = {
  portfolioId?: string;
  type?: EventType;
  startDate?: string;
  endDate?: string;
};

export class EventsApi {
  constructor(private readonly client: BackendClient) {}

  async listEvents(
    filters: EventFilters,
    accessToken: string,
  ): Promise<ListEventsResult> {
    // Two BE reads: by-portfolio returns every event for one property (no date
    // window); the account-wide endpoint takes an optional range. Prefer the
    // former when a portfolio is named so obligations aren't hidden by the
    // endpoint's default "today only" behaviour.
    let path: string;
    if (filters.portfolioId) {
      path = `/portfolio-events/portfolio/${encodeURIComponent(filters.portfolioId)}`;
    } else {
      const qs = new URLSearchParams();
      if (filters.startDate) qs.set("startDate", filters.startDate);
      if (filters.endDate) qs.set("endDate", filters.endDate);
      const suffix = qs.toString();
      path = suffix ? `/portfolio-events?${suffix}` : "/portfolio-events";
    }

    const res = await this.client.request(path, { accessToken });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };

    let events = toEvents(res.body);
    if (filters.type) events = events.filter((e) => e.type === filters.type);
    return { ok: true, status: res.status, events };
  }

  markEventPaid(
    eventId: string,
    body: { transactionAt?: string; note?: string },
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/portfolio-events/${encodeURIComponent(eventId)}/mark-paid`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  markEventUnpaid(
    eventId: string,
    accessToken: string,
  ): Promise<BackendResult> {
    return this.client.request(
      `/portfolio-events/${encodeURIComponent(eventId)}/mark-unpaid`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function toObligation(
  row: Record<string, unknown>,
  type: string | null,
): Obligation | null {
  const key = type ? OBLIGATION_SUBRECORD[type as EventType] : undefined;
  if (!key) return null;
  const sub = row[key];
  if (!sub || typeof sub !== "object") return null;
  const s = sub as Record<string, unknown>;
  return {
    amount: s.amount == null ? null : String(s.amount),
    fraction: s.fraction == null ? null : String(s.fraction),
    paid: Boolean(s.paid),
  };
}

function toEvents(body: string): EventSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  // by-portfolio → { events: [...] }; account-wide → { data: [...] } or [...].
  const p = parsed as { events?: unknown; data?: unknown };
  const rows = p?.events ?? p?.data ?? parsed;
  if (!Array.isArray(rows)) return [];

  const str = (v: unknown) => (v == null ? null : String(v));
  return rows.map((row): EventSummary => {
    const r = row as Record<string, unknown>;
    const type = str(r.type);
    return {
      id: String(r.id ?? ""),
      type,
      startDate: str(r.startDate),
      endDate: str(r.endDate),
      propertyId: str(r.portfolioId),
      unitId: str(r.unitId),
      summary: str(r.summary),
      description: str(r.description),
      obligation: toObligation(r, type),
    };
  });
}
