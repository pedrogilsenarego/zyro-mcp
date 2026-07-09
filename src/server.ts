import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { loadConfig } from "./config.js";
import { ImocertoApi } from "./imocerto.js";
import { ZyroOAuthProvider } from "./oauth.js";
import { createMcpServer } from "./mcp.js";

const config = loadConfig();
const api = new ImocertoApi(config.apiBaseUrl);

const LOGIN_CALLBACK_PATH = "/oauth/login-callback";
const provider = new ZyroOAuthProvider(
  api,
  new TextEncoder().encode(config.jwtSecret),
  LOGIN_CALLBACK_PATH,
);

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "zyro-mcp", apiBaseUrl: config.apiBaseUrl });
});

// Handles the login/consent form submit: authenticate against imocerto, then
// redirect back to the MCP client with an authorization code.
app.post(LOGIN_CALLBACK_PATH, async (req, res) => {
  const fields = {
    clientId: String(req.body.client_id ?? ""),
    redirectUri: String(req.body.redirect_uri ?? ""),
    state: String(req.body.state ?? ""),
    codeChallenge: String(req.body.code_challenge ?? ""),
    email: String(req.body.email ?? ""),
    password: String(req.body.password ?? ""),
  };

  const redirectTo = await provider.completeLogin(fields);
  if (!redirectTo) {
    res.status(401).type("html").send(provider.renderLoginError(fields));
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
    const server = createMcpServer(api, () => accessToken);
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
