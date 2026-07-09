# zyro-mcp (POC)

A remote MCP server that lets Claude create listings in **Zyr-o / imocerto**.
It's a thin gateway in front of the existing backend: Claude's tool calls become
authenticated HTTP requests to your REST API, and the backend enforces all
rules. **Identity comes from the OAuth token (→ the imocerto JWT), never from a
tool argument.**

Connecting uses the standard remote-MCP flow: Claude opens a browser, you log in
and approve, and it's connected. This POC points at your **local** backend and
runs on localhost (no hosting yet).

## How it fits together

    Claude ──MCP──▶ zyro-mcp ──HTTP (Bearer)──▶ imocerto backend
                       │
                       └─ OAuth 2.1 AS: /authorize (login+consent) + /token + DCR
                          login delegates to POST /api/auth/login; the issued
                          access token IS the imocerto JWT.

## Files

    src/config.ts     env config
    src/imocerto.ts   backend client (login + createListing)
    src/oauth.ts      OAuth provider: login/consent page, code exchange, token verify
    src/mcp.ts        MCP server + create_listing tool
    src/server.ts     express wiring (OAuth endpoints + protected /mcp)

## Run

    pnpm install
    cp .env.example .env      # set IMOCERTO_JWT_SECRET to match the backend's
    pnpm dev                  # http://localhost:8080

`IMOCERTO_JWT_SECRET` must equal the backend's `JWT_SECRET` so this server can
verify the tokens it issues. Make sure the imocerto backend is running on
`IMOCERTO_API_BASE_URL`.

## Connect from Claude Code

    claude mcp add --transport http zyro http://localhost:8080/mcp

Claude discovers the OAuth metadata, opens the login/consent page in your
browser, you log in with your imocerto credentials and approve — done. Then:

    "create a room listing titled Sunny Room, 500 euros, roomRent"

## Not built yet (post-POC)

- Hosting (public HTTPS) so claude.ai can add it as a custom connector.
- Refresh tokens (POC re-runs the login flow when the 1h token expires).
- More tools (update/publish listing, list portfolios, images).
- Persistent client/code stores (currently in-memory).

## Backend contract

`POST /api/listing/add` — multipart, `Authorization: Bearer <token>`. Required:
`title`, `rentPrice`, `propertyType`, `businessType`. `userId` is ignored (the
backend derives it from the token).
