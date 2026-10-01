# Domain Services — Gap-closure build note (2026-10-01)

Scope: completion pass over the Domain Services platform (foundation: migrations 0063/0064,
services, routes, UI) against the full 27-section Domain Services directive. This note records
the audit outcome, the gaps that were found, what was changed to close them, and how each
change is verified. Nothing existing was removed or re-architected; every change is additive.

## 1. Audit outcome (what already existed)

Verified working before this pass: the `/domains` hub with the nine service cards in the three
reference groups; all nine service routes plus auction detail; the provider abstraction with
Namecheap, GoDaddy, RDAP and GoValue adapters; write-only AES-GCM provider credentials with a
real Test Connection; honest `provider_not_configured` states everywhere; payment-gated
registration/transfer/club/auction flows that only fulfil after webhook-verified payment and
registrar confirmation (worker sweep); the server-authoritative bidding engine (MCAS +
idempotency keys); RDAP-preferred WHOIS with privacy protection respected; bulk search with
batching and hourly caps; the brokerage schema (`domain_broker_*`) with customer case APIs and a
minimal admin surface; audit logging on every mutating route. Baseline: typecheck green,
726/726 tests green.

## 2. Gaps found and closed

### G1 — Notification coverage (spec §17)

| Event | Before | After |
|---|---|---|
| Domain registration **completed** | only failure was notified | `DOMAIN_REGISTRATION_COMPLETED` on BOTH confirmation paths (settle + polling), dedupe-safe |
| Auction **lost** | winner only | `DOMAIN_AUCTION_LOST` to every distinct losing bidder when the sweep closes the auction |
| Auction **ending soon** | state transition only | `DOMAIN_AUCTION_ENDING_SOON` to every bidder with a live stake, once per auction |
| Broker request created / broker assigned / case **status updates** | none | `DOMAIN_BROKER_CASE_CREATED`, `DOMAIN_BROKER_CASE_BROKER_ASSIGNED`, per-status `DOMAIN_BROKER_CASE_<STATUS>` (one notification per distinct status per case) |
| Broker **offer received** | none | `DOMAIN_BROKER_OFFER_RECEIVED` per offer (resource = the offer) |
| Broker customer-message posted | none | `DOMAIN_BROKER_MESSAGE` per message |
| Broker payment / transfer status changes | none | `DOMAIN_BROKER_PAYMENT_<STATUS>` / `DOMAIN_BROKER_TRANSFER_<STATUS>` on transition only |
| Club **membership renewal** reminder | none | `DOMAIN_CLUB_RENEWAL_REMINDER` once per membership when renewal is ≤ 7 days away |
| **Domain availability** (watchlist) | none | `DOMAIN_AVAILABILITY_ALERT` when the sweep's fresh provider check finds a watched domain available/premium — see G5 |

All sends go through `createNotification`, whose partial unique index on
`(user_id, type, resource_type, resource_id)` makes every one of the above once-only by
construction — including under repeated worker sweeps and MCAS races.

### G2 — Club expiry notification defect (fixed)

`expireLapsedMemberships` previously notified memberships expired **more than a day ago**, and
only when some other membership happened to lapse in the same sweep. A membership expiring
today could therefore never notify its owner. The sweep now captures the just-expired rows and
notifies exactly those members immediately; the dedupe index still guarantees once-only
delivery (regression test: "club expiry notifies the member in the same sweep that lapses the
membership").

### G3 — User dashboard (spec §14)

`/dashboard/domains` gained the missing sections, all fed by their real per-user endpoints:

- **Domain Club** tab — plan, status, price (real plan currency; `MembershipDto.currency` added
  rather than hard-coding one), member since, renewal date, cancelled date.
- **Broker Requests** tab — the caller's `domain_broker_cases` with workflow status, current
  offer, payment and transfer state.
- **Auctions you lost** section (the `…/auctions/my/lost` endpoint existed but was unused).
- **Your bulk searches** section in Searches & Lookups (accepted/rejected counts).

List-loading is shape-defensive (`r.items ?? []`) so a malformed response can never crash the
page render.

### G4 — Broker admin management (spec §15)

Admin previously had list/assign/providers/overview only. Added (all staff-gated, zod-validated,
event + audit written, MCAS where state changes):

| Endpoint | Behaviour |
|---|---|
| `GET /api/v1/admin/domain-brokerage/cases/:id` | full detail incl. internal notes, payment, transfer, assignments |
| `PATCH …/cases/:id/status` | spec §11 lifecycle; same-status is a no-op (no duplicate event/notification); optional note stored internally; concurrent edits rejected via compare-and-swap |
| `POST …/cases/:id/offers` | records broker/seller/provider offers; **supersedes any still-open offer** so a customer can never accept a stale one; customer-bound offers move the case to `offer_received` |
| `POST …/cases/:id/messages` | staff notes (`internal`, never returned by the customer API) or customer messages |
| `PUT …/cases/:id/payment` | upsert; **total computed server-side** from acquisition + broker/transfer/payment fees; case `payment_status` kept in sync |
| `PUT …/cases/:id/transfer` | upsert; initiated/completed timestamps preserved monotonically; case `transfer_status` kept in sync |

Admin UI: new **Broker** tab on `/admin/domain-services` (`AdminBrokerageSection`) — case
search/filter, case detail, status workflow, offer recording, notes/messages, fees & payment,
transfer tracking, timeline. New **Activity** tab (`AdminDomainActivitySection`) — the
registrations, appraisals, WHOIS/RDAP lookups and domain-transactions oversight endpoints that
previously had no UI.

### G5 — Domain availability watchlist (spec §17 "Domain availability", added 2026-10-01 later pass)

The only §17 event with no backing feature. Implemented end to end:

- Migration `0065_create_domain_availability_watches.sql` — one ACTIVE watch per user per domain
  (partial unique index), history rows kept, sweep intake index (stalest-first).
- `availability-watch-service.ts` — create (honest refusal when no registrar is connected;
  idempotent re-watch; 100-watch cap per user), list (owner-only), cancel (owner-only, 404 for
  anything else), and the worker sweep step: the stalest 50 active watches re-checked in ONE
  batched provider call. Only a fresh `available`/`premium` answer flips a watch (compare-and-
  swap) and sends `DOMAIN_AVAILABILITY_ALERT` — provider failures back off without ever marking
  a domain available or killing the watch.
- Routes: `POST/GET/DELETE /api/v1/domain-services/watches[/…]` (authenticated, audit-logged).
- UI: **Watch** button on taken results in `/domains/search` (signed-in users; "Watching ✓"
  state), and a **Domain availability watches** section in the dashboard Searches & Lookups tab
  with cancel and a deep link back to search when a watch fires.

## 3. Verification

- **New integration tests** (`tests/integration/domain-services-notifications.test.ts`, 7 tests
  against embedded Postgres + the simulated registrar): ending-soon once-only; win/lose
  notifications once-only; club expiry same-sweep regression; renewal reminder window +
  once-only; full broker workflow (notifications, supersede, hidden internal notes,
  server-computed payment total, transfer tracking, RBAC 403s); registration completion
  notification once-only across repeated sweeps.
- **Frontend unit test strengthened** (`domain-services-pages.test.tsx`): now also asserts the
  lost-auctions, bulk-searches, Domain Club and Broker Requests dashboard sections.
- Gates: `npm run typecheck` ✅, full `vitest run` ✅, `npm run build:frontend` ✅.
- **Live dev preview** (`scripts/domain-services-demo-preview.ts`, development-only harness
  extended with a club membership + broker case through the real APIs): notifications visible in
  the customer's notification centre include `DOMAIN_REGISTRATION_COMPLETED`,
  `DOMAIN_CLUB_ACTIVATED`, `DOMAIN_BROKER_CASE_CREATED`, `DOMAIN_BROKER_CASE_CONTACTING_SELLER`,
  `DOMAIN_BROKER_OFFER_RECEIVED`, `DOMAIN_BROKER_MESSAGE`.

## 4. What is NOT claimed

- No provider credentials exist in this environment; production registrar/appraisal behaviour
  remains gated on Super Admin configuration and a passing Test Connection (by design).
- The preview's Registrar/RDAP endpoints are the test-suite wire simulation
  (`tests/helpers/mock-registrar.ts`); production talks to real Namecheap/GoDaddy/RDAP.
- Club memberships have no auto-charge; renewal is customer-initiated (existing model), so the
  reminder is once per membership term.
