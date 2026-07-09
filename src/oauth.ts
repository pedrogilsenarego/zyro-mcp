import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { jwtVerify } from "jose";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ImocertoApi } from "./imocerto.js";

const CODE_TTL_MS = 5 * 60 * 1000;

interface StoredCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  accessToken: string; // the imocerto JWT this code will hand back
  expiresAt: number;
}

/** In-memory OAuth client registry (Dynamic Client Registration, POC-grade). */
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<
      OAuthClientInformationFull,
      "client_id" | "client_id_issued_at"
    >,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

/**
 * OAuth 2.1 authorization server that delegates authentication to the existing
 * imocerto login. The access token it issues IS the imocerto JWT, so every
 * downstream call is scoped to that user by the backend.
 */
export class ZyroOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private codes = new Map<string, StoredCode>();

  constructor(
    private readonly api: ImocertoApi,
    private readonly jwtSecret: Uint8Array,
    private readonly loginCallbackPath: string,
  ) {}

  /** Step 1: show the login + consent page (posts back to the callback route). */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    res
      .status(200)
      .type("html")
      .send(
        renderLoginPage(this.loginCallbackPath, {
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          state: params.state ?? "",
          codeChallenge: params.codeChallenge,
          scope: (params.scopes ?? []).join(" "),
        }),
      );
  }

  /**
   * Step 2 (called from the login-callback route): authenticate against the
   * imocerto backend and, on success, mint an authorization code bound to the
   * user's JWT. Returns the redirect URL back to the MCP client, or null if
   * the credentials/redirect_uri are invalid.
   */
  async completeLogin(fields: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    email: string;
    password: string;
  }): Promise<string | null> {
    const client = await this.clientsStore.getClient(fields.clientId);
    if (!client || !client.redirect_uris.includes(fields.redirectUri)) {
      return null; // unknown client / open-redirect guard
    }

    const accessToken = await this.api.login(fields.email, fields.password);
    if (!accessToken) return null;

    const code = randomUUID();
    this.codes.set(code, {
      clientId: fields.clientId,
      redirectUri: fields.redirectUri,
      codeChallenge: fields.codeChallenge,
      accessToken,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const url = new URL(fields.redirectUri);
    url.searchParams.set("code", code);
    if (fields.state) url.searchParams.set("state", fields.state);
    return url.toString();
  }

  /** Re-render the login page with an error (used on bad credentials). */
  renderLoginError(fields: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    return renderLoginPage(this.loginCallbackPath, { ...fields, scope: "", error: true });
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const stored = this.codes.get(authorizationCode);
    if (!stored) throw new Error("Invalid authorization code");
    return stored.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const stored = this.codes.get(authorizationCode);
    this.codes.delete(authorizationCode); // single-use
    if (
      !stored ||
      stored.clientId !== client.client_id ||
      stored.expiresAt < Date.now()
    ) {
      throw new Error("Invalid or expired authorization code");
    }
    return {
      access_token: stored.accessToken,
      token_type: "Bearer",
      expires_in: 3600,
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    // POC: no refresh. When the 1h token expires, the client re-runs the flow.
    throw new Error("Refresh tokens are not supported in this POC");
  }

  /** Verify the imocerto JWT and expose the user id to request handlers. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { payload } = await jwtVerify(token, this.jwtSecret);
    return {
      token,
      clientId: "zyro-mcp",
      scopes: [],
      expiresAt: payload.exp,
      extra: { userId: payload.userId },
    };
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderLoginPage(
  action: string,
  f: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scope: string;
    error?: boolean;
  },
): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${esc(value)}" />`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect Claude to Zyr-o</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;
    min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#1e293b;padding:32px;border-radius:16px;width:340px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 4px} p{font-size:13px;color:#94a3b8;margin:0 0 20px}
  label{display:block;font-size:12px;margin:14px 0 4px;color:#cbd5e1}
  input[type=email],input[type=password]{width:100%;padding:10px;border-radius:8px;border:1px solid #334155;
    background:#0f172a;color:#e2e8f0;box-sizing:border-box}
  button{width:100%;margin-top:22px;padding:11px;border:0;border-radius:8px;background:#6366f1;
    color:#fff;font-weight:600;cursor:pointer}
  .err{background:#7f1d1d;color:#fecaca;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px}
</style></head>
<body><form class="card" method="post" action="${esc(action)}">
  <h1>Connect Claude to Zyr-o</h1>
  <p>Log in to allow Claude to create listings in your account.</p>
  ${f.error ? '<div class="err">Invalid email or password.</div>' : ""}
  ${hidden("client_id", f.clientId)}
  ${hidden("redirect_uri", f.redirectUri)}
  ${hidden("state", f.state)}
  ${hidden("code_challenge", f.codeChallenge)}
  ${hidden("scope", f.scope)}
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autofocus />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required />
  <button type="submit">Log in &amp; allow</button>
</form></body></html>`;
}
