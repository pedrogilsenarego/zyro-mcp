import type { BackendClient } from "../backend/client.js";

// Roles the backend treats as admin (mirrors imocerto's requireAdmin). Kept in
// sync with the backend by the contract test — this is a UX gate only; the
// backend still enforces admin on every admin endpoint.
const ADMIN_ROLES = new Set(["admin", "imocerto"]);

export const isAdminRole = (role: string | null | undefined): boolean =>
  !!role && ADMIN_ROLES.has(role);

type CacheEntry = { role: string | null; expiresAt: number };

// This server is stateless (a fresh McpServer per request), so without a cache
// we'd hit /me on every tools/list and tools/call. Role changes are rare and
// the backend is authoritative regardless, so a short per-process TTL is safe.
const TTL_MS = 60_000;
const roleCache = new Map<string, CacheEntry>();

/**
 * Resolves the caller's role from GET /users/me, cached per user for a minute.
 * Returns null when unauthenticated or the lookup fails — callers treat null as
 * "not admin", so a transient /me failure degrades to hiding admin tools rather
 * than exposing them.
 */
export async function resolveRole(
  client: BackendClient,
  token: string | undefined,
  userId: string | undefined,
): Promise<string | null> {
  if (!token) return null;

  const key = userId ?? token;
  const now = Date.now();
  const cached = roleCache.get(key);
  if (cached && cached.expiresAt > now) return cached.role;

  const res = await client.request("/users/me", { accessToken: token });
  let role: string | null = null;
  if (res.ok) {
    try {
      const parsed = JSON.parse(res.body) as { user?: { role?: string } };
      role = parsed.user?.role ?? null;
    } catch {
      role = null;
    }
  }

  roleCache.set(key, { role, expiresAt: now + TTL_MS });
  return role;
}
