import type { BackendClient } from "../../backend/client.js";
import {
  PAYMENT_TYPE_CODE,
  type PaymentTypeName,
} from "../../generated/contracts.js";

const NAME_BY_CODE: Record<string, PaymentTypeName> = Object.fromEntries(
  Object.entries(PAYMENT_TYPE_CODE).map(([name, code]) => [code, name as PaymentTypeName]),
);

export type ChargeStatus = "pending" | "paid" | "skipped" | "failed" | "void";

export type ListChargesResult =
  | { ok: true; status: number; rows: Record<string, unknown>[] }
  | { ok: false; status: number; body: string };

const withTypeName = (row: Record<string, unknown>) => {
  const code = row.paymentType == null ? null : String(row.paymentType);
  return { ...row, type: code && code in NAME_BY_CODE ? NAME_BY_CODE[code] : null };
};

function toRows(body: string, propertyId?: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = (parsed as { data?: unknown })?.data ?? parsed;
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[])
    .filter((row) => !propertyId || row.propertyId === propertyId)
    .map(withTypeName);
}

export class ChargesApi {
  constructor(private readonly client: BackendClient) {}

  async listCharges(
    filters: { status?: ChargeStatus; propertyId?: string },
    accessToken: string,
  ): Promise<ListChargesResult> {
    const qs = new URLSearchParams();
    if (filters.status) qs.set("status", filters.status);
    const res = await this.client.request(`/charges?${qs.toString()}`, { accessToken });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, rows: toRows(res.body, filters.propertyId) };
  }

  async listRecurringCharges(
    filters: { propertyId?: string },
    accessToken: string,
  ): Promise<ListChargesResult> {
    const res = await this.client.request("/charges/recurring", { accessToken });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, rows: toRows(res.body, filters.propertyId) };
  }
}

export type RecurringChargeUpdate = {
  label?: string | null;
  amount?: number | null;
  dueDay?: number;
  autoPay?: boolean;
  active?: boolean;
};

export type ChargesWriteResult =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number; body: string };

export class ChargesWriteApi {
  constructor(private readonly client: BackendClient) {}

  async updateRecurringCharge(
    id: string,
    updates: RecurringChargeUpdate,
    accessToken: string,
  ): Promise<ChargesWriteResult> {
    const res = await this.client.request(`/charges/recurring/${encodeURIComponent(id)}`, {
      method: "PATCH",
      accessToken,
      body: JSON.stringify(updates),
      headers: { "Content-Type": "application/json" },
    });
    return { ok: res.ok, status: res.status, body: res.body };
  }

  async generateCharges(accessToken: string): Promise<ChargesWriteResult> {
    const res = await this.client.request("/charges/generate", { method: "POST", accessToken });
    return { ok: res.ok, status: res.status, body: res.body };
  }
}
