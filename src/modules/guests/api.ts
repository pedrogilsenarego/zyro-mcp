import type { BackendClient } from "../../backend/client.js";

// Raw BE fields the adapter reads off each guest row; the contract test asserts
// they still exist on GET /guests.
export const GUEST_SOURCE_FIELDS = [
  "id",
  "name",
  "email",
  "phone",
  "status",
  "linkedEvents",
] as const;

// Raw fields the adapter reads off each linkedEvents entry.
export const GUEST_EVENT_SOURCE_FIELDS = [
  "type",
  "startDate",
  "endDate",
  "portfolioId",
  "portfolioName",
  "unitId",
  "unitName",
] as const;

export interface GuestEventSummary {
  // Event type, e.g. 'lease' | 'airbnb_reservation'.
  type: string | null;
  startDate: string | null;
  // The move-out / departure date; null for open-ended stays.
  endDate: string | null;
  propertyId: string | null;
  propertyName: string | null;
  // The specific room/unit; null for whole-property stays.
  unitId: string | null;
  unitName: string | null;
}

export interface GuestSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  // Computed by the BE from the guest's events: active | future | past | none.
  status: string | null;
  // Stays/bookings linked to this guest — powers "who leaves next" etc.
  events: GuestEventSummary[];
}

export type ListGuestsResult =
  | { ok: true; status: number; guests: GuestSummary[] }
  | { ok: false; status: number; body: string };

export class GuestsApi {
  constructor(private readonly client: BackendClient) {}

  // Lists the caller's guests. Identity comes from the token — GET /guests
  // resolves the user itself, so no id is passed. limit is capped at 100 by the
  // BE; we ask for the max so the model sees the whole portfolio in one call.
  async listGuests(accessToken: string): Promise<ListGuestsResult> {
    const res = await this.client.request("/guests?limit=100", { accessToken });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, guests: toSummaries(res.body) };
  }
}

function toSummaries(body: string): GuestSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed as { data?: unknown })?.data ?? []);
  if (!Array.isArray(rows)) return [];

  const str = (v: unknown) => (v == null ? null : String(v));

  return rows.map((row): GuestSummary => {
    const r = row as Record<string, unknown>;
    const rawEvents = Array.isArray(r.linkedEvents) ? r.linkedEvents : [];
    return {
      id: String(r.id ?? ""),
      name: str(r.name),
      email: str(r.email),
      phone: str(r.phone),
      status: str(r.status),
      events: rawEvents.map((e): GuestEventSummary => {
        const ev = e as Record<string, unknown>;
        return {
          type: str(ev.type),
          startDate: str(ev.startDate),
          endDate: str(ev.endDate),
          propertyId: str(ev.portfolioId),
          propertyName: str(ev.portfolioName),
          unitId: str(ev.unitId),
          unitName: str(ev.unitName),
        };
      }),
    };
  });
}
