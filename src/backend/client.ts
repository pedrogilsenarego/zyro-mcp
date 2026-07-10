// Low-level HTTP client for the imocerto backend — the one place that knows its
// base URL and auth scheme. Domain modules build their calls on top of request().

export interface BackendResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface RequestOptions {
  method?: string;
  /** User's imocerto JWT; sets the Bearer header when present. */
  accessToken?: string;
  body?: FormData | string;
  headers?: Record<string, string>;
}

export class BackendClient {
  constructor(private readonly baseUrl: string) {}

  async request(path: string, opts: RequestOptions = {}): Promise<BackendResult> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
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
