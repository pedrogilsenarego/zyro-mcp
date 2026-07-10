import express from "express";
import { importSPKI } from "jose";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { loadConfig } from "./config.js";
import { BackendClient } from "./backend/client.js";
import { ZyroOAuthProvider } from "./oauth.js";
import { createMcpServer } from "./mcp.js";
import { rateLimit } from "./rateLimit.js";

const config = loadConfig();
const backend = new BackendClient(config.apiBaseUrl);

// Exchanges an MCP refresh token with the backend for a fresh access token +
// rotated refresh token. Returns null on any invalid/expired grant.
async function refreshGrant(refreshToken: string) {
  const res = await backend.request("/auth/mcp/token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  try {
    const { data } = JSON.parse(res.body) as {
      data?: { accessToken?: string; refreshToken?: string };
    };
    if (data?.accessToken && data?.refreshToken) {
      return { accessToken: data.accessToken, refreshToken: data.refreshToken };
    }
    return null;
  } catch {
    return null;
  }
}

const verifyKey = await importSPKI(config.jwtPublicKey, "RS256");

const provider = new ZyroOAuthProvider(
  verifyKey,
  config.consentUrl,
  config.clientsStorePath,
  refreshGrant,
);

const app = express();
// Behind Caddy — trust its X-Forwarded-For so the limiter keys off the real IP.
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));

// General flood protection, plus a stricter cap on dynamic client registration
// (unauthenticated + writes to disk).
app.use(rateLimit({ windowMs: 15 * 60_000, max: 300 }));
app.use("/register", rateLimit({ windowMs: 60 * 60_000, max: 10 }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "zyro-mcp", apiBaseUrl: config.apiBaseUrl });
});

// The frontend consent page posts here after the user logs in and approves,
// handing back their imocerto access token. We mint an authorization code and
// redirect the browser back to the MCP client.
app.post("/oauth/consent-callback", async (req, res) => {
  const fields = {
    clientId: String(req.body.client_id ?? ""),
    redirectUri: String(req.body.redirect_uri ?? ""),
    state: String(req.body.state ?? ""),
    codeChallenge: String(req.body.code_challenge ?? ""),
    accessToken: String(req.body.access_token ?? ""),
    refreshToken: req.body.refresh_token
      ? String(req.body.refresh_token)
      : undefined,
  };

  const redirectTo = await provider.completeConsent(fields);
  if (!redirectTo) {
    res.status(400).json({ error: "Invalid consent request" });
    return;
  }
  res.redirect(redirectTo);
});

// OAuth 2.1 endpoints: metadata discovery, dynamic client registration,
// /authorize and /token. Must be mounted at the app root.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(config.publicUrl),
    scopesSupported: ["listings:write"],
    resourceName: "Zyr-o / imocerto",
  }),
);

// The MCP endpoint, protected by the OAuth bearer token.
app.post(
  "/mcp",
  requireBearerAuth({ verifier: provider }),
  async (req, res) => {
    const accessToken = req.auth?.token;
    const userId = req.auth?.extra?.userId as string | undefined;
    const server = createMcpServer(backend, {
      getAccessToken: () => accessToken,
      getUserId: () => userId,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("Error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  },
);

app.listen(config.port, () => {
  console.log(`zyro-mcp listening on ${config.publicUrl}`);
  console.log(`  MCP endpoint:  POST ${config.publicUrl}/mcp`);
  console.log(`  Backend:       ${config.apiBaseUrl}`);
});
