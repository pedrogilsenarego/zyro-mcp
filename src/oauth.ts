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
 * OAuth 2.1 authorization server that delegates authentication + consent to the
 * imocerto frontend (the real app: Google login, existing session, app styling).
 * The access token it issues IS the imocerto JWT, so every downstream call is
 * scoped to that user by the backend.
 */
export class ZyroOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private codes = new Map<string, StoredCode>();

  constructor(
    private readonly jwtSecret: Uint8Array,
    private readonly consentUrl: string,
  ) {}

  /**
   * Step 1: hand off to the frontend consent page, forwarding the OAuth request
   * parameters. The app logs the user in (or reuses their session) and posts
   * their access token back to `/oauth/consent-callback` → `completeConsent`.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const url = new URL(this.consentUrl);
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("code_challenge", params.codeChallenge);
    if (params.state) url.searchParams.set("state", params.state);
    if (params.scopes?.length) url.searchParams.set("scope", params.scopes.join(" "));
    res.redirect(url.toString());
  }

  /**
   * Step 2 (called from the consent-callback route): the frontend has
   * authenticated the user and handed back their imocerto access token. Verify
   * it, then mint an authorization code bound to it. Returns the redirect URL
   * back to the MCP client, or null if the token/redirect_uri is invalid.
   */
  async completeConsent(fields: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    accessToken: string;
  }): Promise<string | null> {
    const client = await this.clientsStore.getClient(fields.clientId);
    if (!client || !client.redirect_uris.includes(fields.redirectUri)) {
      return null; // unknown client / open-redirect guard
    }

    try {
      await jwtVerify(fields.accessToken, this.jwtSecret);
    } catch {
      return null; // not a valid imocerto token
    }

    const code = randomUUID();
    this.codes.set(code, {
      clientId: fields.clientId,
      redirectUri: fields.redirectUri,
      codeChallenge: fields.codeChallenge,
      accessToken: fields.accessToken,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const url = new URL(fields.redirectUri);
    url.searchParams.set("code", code);
    if (fields.state) url.searchParams.set("state", fields.state);
    return url.toString();
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
