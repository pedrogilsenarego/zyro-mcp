# zyro-mcp — Roadmap / TODO

## Housekeeping
- [ ] Commit the current checkpoint (module refactor, create/list/update/delete tools, full test suite, deploy files, docs).

## Tools (per docs/intent-catalog.md)
- [ ] `get_listing` — single-listing detail; also verifies `availableFrom` / `roomFeatures` / `smokingAllowed` actually persist.
- [ ] Location support — resolve an address by mirroring the FE flow: geocode (`/nominatim/search`) → `/locations/closest-parish` → parish + `locationCodes`, then feed into `create_listing`. (Lean: separate `resolve_location` tool so the geocode can be confirmed before it's baked into a real listing.)
- [ ] Images — hard: needs a URL/file pipeline (BE accepts File/Buffer/string). Deferred.
- [ ] List pagination convention — cap rows + "showing N of M" (matters for `list_payments` / `list_events`).
- [ ] Tier 2 tools — properties, payments, lease events, financials.

## Auth / robustness
- [ ] Refresh tokens — implement `exchangeRefreshToken` + issue a refresh token at consent. Requires storing the imocerto refresh token and calling the BE `/auth/refresh` to mint a new JWT. Without it, clients re-auth every hour. Real clients (e.g. LibreChat) expect this.

## Deployment (Hetzner)
- [ ] Confirm the BE access block type — CORS (server-to-server unaffected) vs Hetzner firewall (needs private-network path / IP allowlist).
- [ ] Provision a separate small Hetzner box on the **same private network** as the BE.
- [ ] Point `IMOCERTO_API_BASE_URL` at the BE's **private** IP (skips the public firewall).
- [ ] Public subdomain `mcp.zyro…` + Caddy auto-TLS (Dockerfile / Caddyfile / docker-compose already in repo).
- [ ] Persistent volume for `/app/data` (OAuth client store survives redeploys).
- [ ] Create `.env.production` from `.env.production.example`.

## Security hardening
- [ ] 🔴 Migrate BE JWT signing HS256 → **RS256**, so zyro holds only the public verify key and cannot forge tokens if breached. (Highest-value: today a compromised zyro could mint a token for any user.)
- [ ] 🟠 Rate-limit `/mcp`.
- [ ] 🟠 Keep zyro isolated (separate box) + patched.
- [ ] 🟢 Allowlist only zyro's private IP on the BE side (defense in depth).
- [ ] Multi-instance: move the client store from file → shared DB/Redis before running >1 instance.
