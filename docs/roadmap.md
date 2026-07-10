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
- [x] Refresh tokens — DONE via a dedicated MCP grant (not the browser session, HttpOnly preserved). BE `mcp_oauth_grants` table + `/auth/mcp/grant` (consent) and `/auth/mcp/token` (rotate); zyro relays refresh; FE consent forwards the MCP refresh token. Verified live (grant row created, scoped `listings:write`, 30-day expiry).

## Deployment (Hetzner)
- [x] BE access block is **CORS** (app-level `ALLOWED_ORIGINS`), not a network firewall — confirmed by a server-to-server request from a non-FE host returning 200. So server-to-server (zyro) is unaffected.
- [x] Provisioned a separate Hetzner box (CPX12, Nuremberg) for zyro.
- [x] `IMOCERTO_API_BASE_URL=https://api.zyr-o.app/api` (public URL, server-to-server).
- [x] `mcp.zyr-o.app` (Cloudflare A record, grey cloud) + Caddy auto-TLS — health 200, valid cert.
- [x] Persistent `/app/data` volume + `.env.production` set. **zyro is LIVE in prod.**
- [ ] Commit + push the domain fixes in `Caddyfile` + `.env.production.example` (set on the server but uncommitted, so a fresh clone is stale).

## Security hardening
- [x] 🔴 RS256 — DONE. BE signs access tokens with the RS256 private key; BE + zyro verify with the public key. zyro holds no signing secret (can't forge if breached). BE deployed to prod, app login verified. `verifyToken` keeps an HS256 fallback for transition.
- [ ] Decouple BE from `JWT_SECRET` (then drop it): ✅ HS256 fallback removed — `verifyToken` is RS256-only. Remaining: make the refresh token opaque (it's DB-looked-up, not sig-verified) and give `alertUnsubscribe` its own secret; then `JWT_SECRET` can be dropped entirely.
- [x] 🟠 Rate-limit — in-memory per-IP limiter (general 300/15min + strict 10/hr on `/register`), trust-proxy for Caddy. Needs redeploy.
- [ ] 🟠 Keep zyro isolated (separate box) + patched.
- [ ] 🟢 Allowlist only zyro's private IP on the BE side (defense in depth).
- [ ] Multi-instance: move the client store from file → shared DB/Redis before running >1 instance.
