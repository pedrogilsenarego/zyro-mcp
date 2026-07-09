/**
 * Thin HTTP client for the imocerto backend. No business logic lives here —
 * it forwards the caller's request with their bearer token and lets the
 * backend enforce access/plan/verification rules.
 */

export interface CreateListingInput {
  title: string;
  rentPrice: number;
  propertyType: string;
  businessType: string;
  listingType?: "supply" | "demand";
}

export interface BackendResult {
  ok: boolean;
  status: number;
  body: string;
}

export class ImocertoApi {
  constructor(private readonly baseUrl: string) {}

  /** POST /auth/login → returns the 1h access-token JWT, or null on failure. */
  async login(email: string, password: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken?: string };
      return data.accessToken ?? null;
    } catch {
      return null;
    }
  }

  /** POST /listing/add as multipart/form-data with the user's bearer token. */
  async createListing(
    input: CreateListingInput,
    accessToken: string,
  ): Promise<BackendResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }

    try {
      const res = await fetch(`${this.baseUrl}/listing/add`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        body: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
