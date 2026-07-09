export interface Config {
  /** Base URL of the imocerto backend REST API (this server proxies to it). */
  apiBaseUrl: string;
  /** Public base URL of THIS server — the OAuth issuer / resource identifier. */
  publicUrl: string;
  /** Port to listen on. */
  port: number;
  /** Shared secret used to verify imocerto access-token JWTs (HS256). */
  jwtSecret: string;
  /** Frontend page that renders the login + consent UI (the real app). */
  consentUrl: string;
}

export function loadConfig(): Config {
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  if (!Number.isFinite(port)) throw new Error(`Invalid PORT: ${process.env.PORT}`);

  const apiBaseUrl = (
    process.env.IMOCERTO_API_BASE_URL || "http://localhost:3000/api"
  ).replace(/\/+$/, "");

  const publicUrl = (
    process.env.PUBLIC_URL || `http://localhost:${port}`
  ).replace(/\/+$/, "");

  const jwtSecret = process.env.IMOCERTO_JWT_SECRET || "";
  if (!jwtSecret) {
    throw new Error(
      "IMOCERTO_JWT_SECRET is required — it must match the backend's JWT_SECRET so this server can verify access tokens.",
    );
  }

  // Locale-less: the frontend resolves the user's language and forwards to the
  // localized consent page.
  const consentUrl = (
    process.env.FRONTEND_CONSENT_URL || "http://localhost:3000/oauth-consent"
  ).replace(/\/+$/, "");

  return { apiBaseUrl, publicUrl, port, jwtSecret, consentUrl };
}
