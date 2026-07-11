import type { BackendClient } from "../../backend/client.js";

// Raw BE fields the adapter reads off each user row; the contract test asserts
// they still exist on GET /users/search.
export const USER_SOURCE_FIELDS = ["id", "name", "email"] as const;

export interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
}

export type FindUsersResult =
  | { ok: true; status: number; users: UserSummary[] }
  | { ok: false; status: number; body: string };

export class UsersApi {
  constructor(private readonly client: BackendClient) {}

  // Searches all users by name or email. Available to any verified user — the
  // BE returns a minimal, role-free projection and excludes the caller itself.
  // Identity comes from the token, so no user id is passed.
  async findUsers(
    query: string,
    limit: number,
    accessToken: string,
  ): Promise<FindUsersResult> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await this.client.request(`/users/search?${qs.toString()}`, {
      accessToken,
    });
    if (!res.ok) return { ok: false, status: res.status, body: res.body };
    return { ok: true, status: res.status, users: toSummaries(res.body) };
  }
}

function toSummaries(body: string): UserSummary[] {
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

  return rows.map((row): UserSummary => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      name: str(r.name),
      email: str(r.email),
    };
  });
}
