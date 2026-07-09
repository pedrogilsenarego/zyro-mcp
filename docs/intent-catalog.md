# zyro-mcp — Intent Catalog

The MCP tool surface is a **product surface for an assistant**, not a mirror of the
backend API. The imocerto backend has ~375 endpoints across 36 route files; this
catalog curates them down to ~15 tools designed around **user intents** ("I want
to…"), not REST routes.

## Design rules

- **Tools map to jobs a user would ask an assistant to do**, not to endpoints.
- **Writes** = explicit per-action tools (safety + clear LLM selection).
- **Reads** = coarse (one search, one get) rather than one tool per entity/filter.
- Tools call the backend over HTTP carrying the user's JWT (scoped by the OAuth
  flow). Business logic stays on the backend; the thin wrapper (`imocerto.ts`) is
  the adapter layer that shields tool schemas from endpoint churn.
- Target size: ~10–25 tools. Never grow toward 375 — most endpoints are internal
  plumbing an assistant should never touch.
- **Return shape = curated, not raw.** The wrapper trims each response to an
  assistant-friendly subset (the fields you'd actually show/reason over) instead of
  passing the raw BE payload. List/search tools return a tight per-row shape; single
  `get` tools return a fuller but still curated shape. This keeps context cheap,
  answers focused, and the output contract owned by the MCP (shielded from BE field
  churn). A `verbose`/`fields` escape hatch is added only if a real case needs it —
  not speculatively.

## Decisions so far

- **Primary user:** both personas equally (portfolio owner + marketplace) → Tier 1
  stays the mixed ~8-tool cut.
- **Access:** auth-only (see Access model below).
- **Return shape:** curated (see rule above).
- **Build cadence:** one tool at a time, end to end, reviewed before the next.

## Access model

The MCP is **auth-only** — there is no anonymous path. Every tool call carries a
logged-in user's JWT (via the OAuth flow), so:

- Every tool operates as "the current logged-in user." No `userId` is ever passed.
- The backend's public / optional-auth / auth distinction is irrelevant to tool
  design — from the MCP everything is uniformly authenticated. (`optionalAuth`
  endpoints return richer results when logged in, which we always are.)
- Anonymous/lead flows (`chatLead`, public `al-checkins/:token`) cannot apply and
  are excluded.

## Personas (all logged-in)

1. **Portfolio owner** — manages properties, units, leases, payments, financials.
2. **Marketplace user** — creates/finds listings, tracks matches.
3. **Collaborator** (later) — sharing, chat, connections, notifications.

---

## Tier 1 — Core (build first, 8 tools)

| Tool | Intent | Maps to BE | R/W | Notes / gap |
|---|---|---|---|---|
| `search_real_estate` | "find 2-bed flats in Porto under €300k" | `GET /real-estate`, `/latest`, `/coords`; `GET /listing`, `/coords`; `GET /filters/*` | R | **Gap:** spread across 3 route files. Wrap now; a unified `/v1/search` endpoint later keeps this tool stable. |
| `list_listings` | "what are my listings?" | `GET /listing/user/:userId` — `userId` resolved from the JWT, never passed by the assistant | R | Returns ALL own + shared listings (incl. drafts/inactive; excludes deleted). No BE work. Needed so `delete_listing`/`update_listing` can discover ids. |
| `get_listing` | "show me listing X" | `GET /listing/:id` (+ `/history`, `/zone-price`, `/views-timeseries` optional) | R | Clean. |
| `create_listing` ✅ | "post a listing" | `POST /listing/add` | W | **Already built.** |
| `delete_listing` ✅ | "take down that listing" | `DELETE /listing/:id` | W | **Already built.** Id comes from `list_listings`/`create_listing`. |
| `update_listing` | "change price / publish / swap photos" | `PATCH /listing/:id`, `/publish-status`, `/images`, `/match-alerts` | W | Coarse over 4 PATCH routes. |
| `get_listing_matches` | "any matches for my listings?" | `GET /listing/:id/matches`, `GET /listing/my/alerts` | R | High-value. |
| `list_properties` | "what's in my portfolio?" | `GET /property`, `/property/:id`, `/property/unit/:id` | R | Portfolio overview. |
| `get_financials` | "how's my portfolio doing this month?" | `GET /financials/property/:id`, `/financials/user/summary` | R | Maps cleanly, no gap. |

---

## Tier 2 — Portfolio management (6 tools)

| Tool | Intent | Maps to BE | R/W | Notes / gap |
|---|---|---|---|---|
| `create_property` | "add a property / unit" | `POST /property/add`, `POST /property/business/:id/unit` | W | |
| `update_property` | "update mortgage/condo/photos/unit" | `PUT /property/:id`, `PATCH /:id/images`, `PUT /:id/credit`, `/condominium`, `PATCH /unit/:id` | W | Coarse. |
| `list_payments` | "show payments for this property" | `GET /payments`, `/payments/eligible-payers/:id` | R | |
| `record_payment` | "log a €500 rent payment" | `POST /payments/add`, `/bulk`, `PUT /update/:id`, `DELETE /delete/:id` | W | Coarse. |
| `list_lease_events` | "what leases/events are active?" | `GET /portfolio-events` (+ `/:id`, `/by-unit/:id`, `/portfolio/:id`) | R | |
| `manage_lease_event` | "create a lease, mark IMI paid" | `POST /portfolio-events`, `PATCH /:id`, `DELETE /:id`, `/mark-paid`, `/mark-unpaid` | W | Coarse. |

---

## Tier 3 — Collaboration / comms (later, on demand)

Grouped, low urgency — each maps cleanly to its existing route file:
`manage_property_shares`, `manage_connections`, `send_message` / `list_conversations`,
`get_notifications` (+ mark viewed), `manage_favorites`, `manage_saved_searches`,
`manage_tags`, `manage_groups`, `manage_guests`, `get_profile` / `update_profile`.

Pull one up only when a real "I want to…" appears.

---

## Explicitly excluded (and why)

| Area | Why it's out |
|---|---|
| `auth/*` (login, signup, refresh, reset) | Identity is handled by the OAuth flow — the MCP already carries the user's JWT. An assistant logging users in/out is wrong and unsafe. |
| `subscription/*` (checkout, portal, verify, sync) | Stripe **redirect** flows don't work through an assistant. *(Gap: no `GET /subscriptions/me` exists; add one small read endpoint if the assistant should report plan status.)* |
| `agents/*` | That's the AI agent itself — exposing it to an MCP client is recursion. |
| `chatLead`, public `al-checkins/:token` | Anonymous/public token flows, not authed user actions. |
| `admin`, `backoffice`, `auditLog`, `dev`, `health`, `img`, `nominatim`, `seo`, `sitemap`, `storage` | Internal/infra plumbing — no user intent. |
| `webhooks/stripe` | Machine-to-machine. |

---

## BE gaps (targeted, not blocking)

1. **Unified search endpoint** — `search_real_estate` spans realEstate + listing +
   filters. Works via the wrapper today; a single coarse `/v1/search` would make the
   tool rock-solid. *Not blocking.*
2. **`GET /subscriptions/me`** — only if the assistant should report plan/limits.
3. Everything else in Tier 1–2 maps to endpoints that **already exist** — Tier 1 can
   ship with **zero** BE work.

---

## Build order

1. **Tier 1 first**, starting with the zero-BE-work wins: `delete_listing`,
   `get_listing`, `list_properties`.
2. Then the coarse reads/writes: `search_real_estate`, `get_financials`,
   `get_listing_matches`, `update_listing`.
3. Tier 2 once the portfolio-owner flows are validated.
4. Tier 3 on demand.
