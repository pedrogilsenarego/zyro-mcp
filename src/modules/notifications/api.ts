import type { BackendClient } from "../../backend/client.js";

// Raw BE fields the adapter reads off each notification row; the contract test
// asserts they still exist on GET /notifications.
export const NOTIFICATION_SOURCE_FIELDS = [
  "id",
  "notificationType",
  "resourceId",
  "title",
  "message",
  "data",
  "viewedAt",
  "interactedAt",
  "createdAt",
] as const;

export interface NotificationSummary {
  id: string;
  // e.g. 'listing_match' | 'al_check_in_submitted' | 'property_share_accepted'.
  notificationType: string | null;
  resourceId: string | null;
  title: string | null;
  message: string | null;
  // The extra-context JSON payload as stored (stringified). For match/price
  // notifications this is where the listing image lives (data.image); it is
  // null/absent for types that carry no image.
  data: string | null;
  viewedAt: string | null;
  interactedAt: string | null;
  createdAt: string | null;
}

export type ListNotificationsResult =
  | { ok: true; status: number; notifications: NotificationSummary[] }
  | { ok: false; status: number; body: string };

export class NotificationsApi {
  constructor(private readonly client: BackendClient) {}

  // Lists the caller's notifications, newest first. Identity comes from the
  // token — GET /notifications resolves the user itself, so no id is passed.
  // limit is capped at 100 by the BE.
  async listNotifications(
    limit: number,
    accessToken: string,
  ): Promise<ListNotificationsResult> {
    const res = await this.client.request(
      `/notifications?limit=${limit}`,
      { accessToken },
    );
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return {
      ok: true,
      status: res.status,
      notifications: toSummaries(res.body),
    };
  }
}

function toSummaries(body: string): NotificationSummary[] {
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

  return rows.map((row): NotificationSummary => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      notificationType: str(r.notificationType),
      resourceId: str(r.resourceId),
      title: str(r.title),
      message: str(r.message),
      // Keep data as a string so the raw payload (incl. image) is visible.
      data:
        r.data == null
          ? null
          : typeof r.data === "string"
            ? r.data
            : JSON.stringify(r.data),
      viewedAt: str(r.viewedAt),
      interactedAt: str(r.interactedAt),
      createdAt: str(r.createdAt),
    };
  });
}
