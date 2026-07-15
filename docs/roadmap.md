# zyro-mcp — Roadmap / TODO

## ⛔ Hardening gate — address before adding more tools

The module shape scales; the governance around it doesn't yet. Clear these
before widening the tool surface — each new cross-user tool multiplies the risk
below, it doesn't add to it linearly.

- [ ] 🔴 **Per-tool cross-user exposure audit (make it a required step).** The MCP
  is now an *amplifier* of backend authz gaps: `find_users` hands out ids and
  cross-user tools make probing other accounts trivial. We only caught the
  `GET /listing/user/:userId` leak (returned any user's drafts/inactive to
  anyone) by going looking — it was luck, not process. **Every tool that accepts
  another user's id must be signed off with "what does this endpoint expose
  across users, at every status?" before it ships.** Add this to the tool
  checklist. (Backend fix already shipped: non-owner/non-admin now gets
  active-only; owner/admin get all statuses.)
- [ ] 🟠 **Single-source the admin-role set.** `isAdminRole` / `{admin, imocerto}`
  is duplicated in backend `middleware/requireAdmin.ts` and MCP
  `modules/identity.ts`. A new backend role drifts silently. Route it through
  the existing `gen:contracts` pipeline so both read one source.
- [ ] 🟠 **Bound the role cache.** `modules/identity.ts` uses an unbounded `Map`
  (one entry per distinct user, never evicted) — a slow leak in a long-lived
  process. Add a max size or periodic sweep alongside the 60s TTL.
- [ ] 🟠 **Contract tests into CI.** They're the drift net but skip without a
  token, so CI almost certainly isn't running them. Stand up a CI job with a
  seeded backend + service token (admin token for the `/admin/*` contracts).
  Drift protection that's opt-in isn't protection.
- [ ] 🟢 **Authz stays single-sourced (principle, not a task).** MCP role checks
  (conditional registration, active-only framing) are **UX only**; the backend
  is the enforcement boundary. Never add an MCP rule the backend doesn't also
  enforce, and never treat the MCP gate as the real control.
- [ ] 🟢 **Response token budget.** Tools return full JSON; `admin_list_user_listings`
  (cap 100) and future large-account reads will be token-heavy. Fold into the
  pagination convention below (cursor + "showing N of M", not just a cap).

## Tools (per docs/intent-catalog.md)
- [ ] Location support — `create_listing` already geocodes the place name
  (`/nominatim/search`) to coords. Remaining: resolve parish + `locationCodes`
  (mirror the FE `/locations/closest-parish` flow) and expose a separate
  `resolve_location` tool so the geocode can be confirmed before it's baked into
  a real listing.
- [ ] Images — hard: needs a URL/file pipeline (BE accepts File/Buffer/string).
  Deferred.
- [ ] List pagination convention — cap rows + "showing N of M". `list_payments`
  already reports "N of total"; make it uniform (cursor, not just a cap) across
  `list_events` and future reads. Ties to the response-token-budget item above.

## Deployment
- [ ] Commit + push the domain fixes in `Caddyfile` + `.env.production.example`
  (set on the server but may be stale vs. a fresh clone).

## Security hardening
- [ ] Decouple BE from `JWT_SECRET`, then drop it. HS256 fallback already
  removed (`verifyToken` is RS256-only). Remaining: make the refresh token
  opaque (it's DB-looked-up, not sig-verified) and give `alertUnsubscribe` its
  own secret — then `JWT_SECRET` can go entirely.
- [ ] Keep zyro isolated (separate box) + patched.
- [ ] Allowlist only zyro's private IP on the BE side (defense in depth).
- [ ] Multi-instance: move the client store from file → shared DB/Redis before
  running >1 instance.
