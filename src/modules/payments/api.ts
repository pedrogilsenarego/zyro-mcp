import type { BackendClient, BackendResult } from "../../backend/client.js";
import {
  PAYMENT_TYPE_CODE,
  type PaymentTypeName,
} from "../../generated/contracts.js";

// Raw BE fields toPayment reads off each enriched payment row (GET /payments).
// The contract test asserts they still exist so curation can't silently drift.
export const PAYMENT_SOURCE_FIELDS = [
  "id",
  "paymentType",
  "value",
  "note",
  "transactionAt",
  "targets",
  "paidByUser",
  "createdByUser",
] as const;

// name → code for writes; code → name for reads. Derived from the generated
// map so both directions stay in sync with the single source of truth.
const NAME_BY_CODE: Record<string, PaymentTypeName> = Object.fromEntries(
  Object.entries(PAYMENT_TYPE_CODE).map(([name, code]) => [
    code,
    name as PaymentTypeName,
  ]),
);

export type PaymentUser = {
  id: string;
  name: string | null;
  email: string | null;
};

export type PaymentSummary = {
  id: string;
  // Friendly name (e.g. "leaseRent"); null if the BE code is unknown to us.
  type: PaymentTypeName | null;
  // Signed amount as stored: positive = income (e.g. rent received),
  // negative = expense.
  value: string | null;
  note: string | null;
  transactionAt: string | null;
  propertyId: string | null;
  unitId: string | null;
  // Who actually paid (may be null if not recorded).
  paidBy: PaymentUser | null;
  // Who recorded the payment in the account.
  recordedBy: PaymentUser | null;
};

export type ListPaymentsResult =
  | { ok: true; status: number; payments: PaymentSummary[]; total: number }
  | { ok: false; status: number; body: string };

export type EligiblePayer = PaymentUser & { isCollaborator: boolean };

export type ListEligiblePayersResult =
  | { ok: true; status: number; payers: EligiblePayer[] }
  | { ok: false; status: number; body: string };

export type PaymentFilters = {
  portfolioId?: string;
  unitId?: string;
  paymentType?: PaymentTypeName;
  transactionType?: "income" | "expense";
  startDate?: string;
  endDate?: string;
  limit?: number;
};

export type RecordPaymentInput = {
  paymentType: PaymentTypeName;
  value: number;
  propertyId?: string;
  propertyUnitId?: string;
  paidByUserId?: string;
  transactionAt?: string;
  note?: string;
};

export class PaymentsApi {
  constructor(private readonly client: BackendClient) {}

  async listPayments(
    filters: PaymentFilters,
    accessToken: string,
  ): Promise<ListPaymentsResult> {
    const qs = new URLSearchParams();
    if (filters.portfolioId) qs.set("portfolioId", filters.portfolioId);
    if (filters.unitId) qs.set("unitId", filters.unitId);
    if (filters.paymentType)
      qs.set("paymentType", PAYMENT_TYPE_CODE[filters.paymentType]);
    if (filters.transactionType)
      qs.set("transactionType", filters.transactionType);
    if (filters.startDate) qs.set("startDate", filters.startDate);
    if (filters.endDate) qs.set("endDate", filters.endDate);
    qs.set("limit", String(filters.limit ?? 50));

    const res = await this.client.request(`/payments?${qs.toString()}`, {
      accessToken,
    });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    const { payments, total } = toPayments(res.body);
    return { ok: true, status: res.status, payments, total };
  }

  async recordPayment(
    input: RecordPaymentInput,
    accessToken: string,
  ): Promise<BackendResult> {
    // The BE injects userId from the token and expects the numeric type code.
    const body = {
      paymentType: PAYMENT_TYPE_CODE[input.paymentType],
      value: input.value,
      propertyId: input.propertyId,
      propertyUnitId: input.propertyUnitId,
      paidByUserId: input.paidByUserId,
      transactionAt: input.transactionAt,
      note: input.note,
    };
    return this.client.request("/payments/add", {
      method: "POST",
      accessToken,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  async listEligiblePayers(
    propertyId: string,
    accessToken: string,
  ): Promise<ListEligiblePayersResult> {
    const res = await this.client.request(
      `/payments/eligible-payers/${encodeURIComponent(propertyId)}`,
      { accessToken },
    );
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, payers: toPayers(res.body) };
  }
}

function toUser(v: unknown): PaymentUser | null {
  if (!v || typeof v !== "object") return null;
  const u = v as Record<string, unknown>;
  if (!u.id) return null;
  const str = (x: unknown) => (x == null ? null : String(x));
  return { id: String(u.id), name: str(u.name), email: str(u.email) };
}

function toPayments(body: string): {
  payments: PaymentSummary[];
  total: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { payments: [], total: 0 };
  }
  const rows = (parsed as { data?: unknown })?.data ?? parsed;
  const total =
    (parsed as { metadata?: { pagination?: { total?: number } } })?.metadata
      ?.pagination?.total ?? (Array.isArray(rows) ? rows.length : 0);
  if (!Array.isArray(rows)) return { payments: [], total: 0 };

  const str = (v: unknown) => (v == null ? null : String(v));
  const payments = rows.map((row): PaymentSummary => {
    const r = row as Record<string, unknown>;
    const targets = (r.targets ?? {}) as Record<string, unknown>;
    const code = str(r.paymentType);
    return {
      id: String(r.id ?? ""),
      type: code && code in NAME_BY_CODE ? NAME_BY_CODE[code] : null,
      value: str(r.value),
      note: str(r.note),
      transactionAt: str(r.transactionAt),
      propertyId: str(targets.propertyId),
      unitId: str(targets.unitId),
      paidBy: toUser(r.paidByUser),
      recordedBy: toUser(r.createdByUser),
    };
  });
  return { payments, total };
}

function toPayers(body: string): EligiblePayer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = (parsed as { data?: unknown })?.data ?? parsed;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): EligiblePayer | null => {
      const user = toUser(row);
      if (!user) return null;
      return { ...user, isCollaborator: Boolean((row as any).isCollaborator) };
    })
    .filter((p): p is EligiblePayer => p !== null);
}
