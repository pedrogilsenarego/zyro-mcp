export interface Config {
  /** Base URL of the imocerto backend REST API (this server proxies to it). */
  apiBaseUrl: string;
  /** Public base URL of THIS server — the OAuth issuer / resource identifier. */
  publicUrl: string;
  /** Port to listen on. */
  port: number;
  /** RS256 public key (PEM) used to verify imocerto access-token JWTs. This
   * server only ever verifies — it never holds a signing key, so a breach here
   * cannot forge tokens. */
  jwtPublicKey: string;
  /** Frontend page that renders the login + consent UI (the real app). */
  consentUrl: string;
  /** File where registered OAuth clients are persisted across restarts. */
  clientsStorePath: string;
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

  const jwtPublicKey = (process.env.IMOCERTO_JWT_PUBLIC_KEY || "").replace(
    /\\n/g,
    "\n",
  );
  if (!jwtPublicKey) {
    throw new Error(
      "IMOCERTO_JWT_PUBLIC_KEY is required — the backend's RS256 public key, used to verify access tokens.",
    );
  }

  // Locale-less: the frontend resolves the user's language and forwards to the
  // localized consent page.
  const consentUrl = (
    process.env.FRONTEND_CONSENT_URL || "http://localhost:3000/oauth-consent"
  ).replace(/\/+$/, "");

  const clientsStorePath =
    process.env.OAUTH_CLIENTS_PATH || "./data/oauth-clients.json";

  return { apiBaseUrl, publicUrl, port, jwtPublicKey, consentUrl, clientsStorePath };
}
