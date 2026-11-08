# WHMCS integration — operator and developer guide

**Status:** the integration layer, the mapping gate, the public orderability endpoint (B2.4), the one-identity SSO
bridge (B5.1, security-reviewed) and the C1 discovery tooling are implemented; **no storefront page is wired to them
yet**, and the SPA's own catalogue and checkout are untouched. Nothing has been run against a live WHMCS installation.
See [`WHMCS-INTEGRATION-REPORT.md`](WHMCS-INTEGRATION-REPORT.md) for the phase-by-phase evidence and exactly what is
blocking C1, and [`WHMCS-INTEGRATION-AUDIT.md`](WHMCS-INTEGRATION-AUDIT.md) §9 for the slice plan and delivery log.

This document is the practical companion: what the pieces are, how to turn the integration on, and the rules a
change has to follow.

---

## 1. The one rule

> **The website never decides what something costs, whether an order succeeded, or whether a service was
> provisioned. WHMCS decides; the website asks.**

Everything below is a consequence of that sentence.

---

## 2. What is where

| File | Role |
| --- | --- |
| `src/whmcs/config.ts` | Reads `WHMCS_*` from the environment. Returns `enabled: false` with a named reason when unset — it does not throw at boot, because the site must keep serving pages while checkout reports itself disconnected. Refuses `http` for any non-loopback host. |
| `src/whmcs/errors.ts` | Typed failures, each with a customer-safe message (`safeCustomerMessage`) and a log redactor (`redactForLog`). |
| `src/whmcs/transport.ts` | The only network code. POST form body, no redirects followed, 10 s abort signal, 1 MiB response cap. Swappable so tests can drive every failure mode. |
| `src/whmcs/client.ts` | Authentication, JSON parsing, `result=error` handling, retries **for reads only**, circuit breaker after 5 consecutive failures, request ids, redacted logging. |
| `src/whmcs/schemas.ts` | Validated response shapes. `-1`, `""` and missing cycles are handled once, here. |
| `src/whmcs/catalogue.ts` | Normalises products/groups/pricing into what a page may display. Cycles appear only when WHMCS configured them; a currency with no price raises rather than falling back. |
| `src/whmcs/product-map.ts` | Loads the checksummed service → product map and verifies every binding against the snapshot. |
| `src/whmcs/cart.ts` | Builds `cart.php?a=add&pid=…&billingcycle=…` from a verified binding — and nothing else. |
| `src/whmcs/idempotency.ts` | Durable ledger (`whmcs_operations`, migration `0086`) so a retry is a question, not a second command. |
| `src/whmcs/sso.ts` | B5.1 one-identity layer: the account ↔ WHMCS-client link, the allow-listed destinations, the redirect-origin check, and `CreateSsoToken` (migration `0087`). The token itself is never stored. |
| `src/routes/account-whmcs.ts` | The four customer endpoints (`GET/POST/DELETE /api/v1/account/whmcs`, `POST …/sso`). Registered in `app.ts`; answers `configured: false` until credentials exist. |
| `src/whmcs/orderability.ts` | B2.4 — the single verdict "may this service be bought online, and in which cycles": binding ∩ live product ∩ priced cycles, plus a 60-second single-flight catalogue cache. |
| `src/routes/whmcs-public.ts` | `GET /api/v1/whmcs/orderability[/:serviceKey]`. Anonymous, never a 500 for a WHMCS problem, fails closed on a broken map. |
| `src/whmcs/discovery.ts` | C1 read-only discovery: reads groups/products/currencies into a reviewable artifact and renders the Markdown report. Issues no write action, by construction. |
| `scripts/whmcs/catalogue-map.ts` | Operator CLI: `snapshot`, `bind`, `dispose`, `dispositions`, `verify`. |
| `config/whmcs/product-map.json` | The generated map. Currently **0 bindings, 59 dispositions**. |
| `config/whmcs/service-register.csv` (repository root) | Cross-stack inventory of advertised services, shared with the PHP/WHMCS side. |
| `tests/unit/whmcs-*.test.ts`, `tests/integration/whmcs-*.test.ts` | 153 tests across 12 files: the layer, the completeness gate, the orderability verdict, the identity bridge and the discovery pipeline. |

---

## 3. Turning it on

1. **Create an API credential in WHMCS** — *System Settings → Staff Management → API Credentials*. Give it the
   smallest role that can read products (and, later and separately, orders). Do not reuse an administrator's
   credentials.
2. **Set the environment** (cPanel → *Setup Node.js App* → environment variables, or `.env`):

   ```
   WHMCS_BASE_URL=https://billing.example.com
   WHMCS_API_IDENTIFIER=…
   WHMCS_API_SECRET=…
   WHMCS_MODE=read-only
   ```

   Leave `WHMCS_MODE=read-only` until the read path is verified in staging. `full` is what permits orders,
   payments and provisioning actions to be sent at all.
3. **Run the preflight before anything else** (read-only, writes nothing):

   ```bash
   npm run whmcs:doctor      # config, mode, MFA policy, then live catalogue counts with pass/fail
   npm run whmcs:discover    # C1: config/whmcs/catalogue-snapshot.json + docs/WHMCS-DISCOVERY-REPORT.md
   ```

   `discover` binds nothing. Review the report, then `snapshot` and `bind` service by service — see §4.

4. **Restart the application**, then check the reason it reports:

   ```bash
   node -e "const {loadWhmcsConfig}=require('./dist/src/whmcs/config');console.log(loadWhmcsConfig())"
   ```

5. **Take a snapshot** (read-only — calls `GetProductGroups`, `GetProducts`, `GetCurrencies`):

   ```bash
   npm run whmcs:map -- snapshot
   npm run whmcs:map -- verify
   ```

6. **Bind each advertised service** to the product it actually sells:

   ```bash
   npm run whmcs:map -- bind --service hosting-vps --product 12
   npm run whmcs:map -- bind --service hosting-vps --product 12 --cycles monthly,annually
   ```

   `bind` refuses a product id that is not in the snapshot, a cycle WHMCS does not offer, and a product with no
   configured price.

7. **Dispose of what is not orderable** — with a reason, not silently:

   ```bash
   npm run whmcs:map -- dispose --service hosting-plesk --reason "no Plesk product configured in WHMCS"
   ```

8. **Commit the map.** It is a generated artifact: regenerating it is normal, hand-editing it is not possible
   without the checksum failing.

---

## 4. Adding a service page

1. Add the page to `shared/site/content/*.json` (or the SPA router for domain surfaces) and regenerate.
2. The completeness gate (`tests/unit/whmcs-service-coverage.test.ts`) will fail until the service has a
   disposition. That is the point: run `npm run whmcs:map -- dispositions` to record the reason it is not yet
   orderable, or `bind` it to a product.
3. Update `config/whmcs/service-register.csv` (the cross-stack inventory) with its row.

---

## 5. Rules a change must not break

| Rule | Enforced by |
| --- | --- |
| No product id is written anywhere except the generated map | `openProductMap` rejects a binding whose product is not in the snapshot; the coverage test rejects bindings for unadvertised services |
| A price is never computed, defaulted or converted locally | `catalogue.ts` only reformats what WHMCS returned; `WhmcsCurrencyUnavailableError` instead of a fallback |
| A cycle is offered only when WHMCS configured it | `cyclePrice()` treats `-1`/`""` as not offered; `buildCartUrl` rejects an unoffered cycle |
| No order/payment action retries blindly | `client.ts` sets `maxAttempts = 1` for writes; `idempotency.ts` distinguishes `pending` (reconcile) from `failed` (retry) |
| Credentials are server-side only | `config.ts` is the only reader; the client never logs the body; a unit test scans the layer for assigned secrets |
| Missing configuration degrades honestly | `loadWhmcsConfig` returns `enabled: false` with a reason; routes must surface it rather than 500 |
| WHMCS downtime is not a broken shop | typed `WHMCS_TIMEOUT`/`WHMCS_UNREACHABLE` + circuit breaker; `safeCustomerMessage` phrases the customer state |

---

## 6. What is deliberately *not* implemented yet

- **No page consumes the endpoint yet.** `GET /api/v1/whmcs/orderability` exists and answers honestly (`NOT_INTEGRATED`
  for all 59 services), but no SPA component calls it. Wiring is slice C2 and needs a real `pid` to be meaningful.
- **Configurable options in the cart URL.** WHMCS accepts several parameter conventions and this project has not
  verified which one the target installation honours; configuration stays inside the WHMCS cart until staging
  proves otherwise.
- **SSO into the cart, and SSO initiated from WHMCS.** B5.1 hands a session *out* to the client area only. The
  reverse direction (WHMCS → SPA) is not implemented because it cannot be done without an inbound token endpoint
  on this side; do not add one without a design review.
- **WHMCS-side logout.** WHMCS exposes no API to end a client session. Signing out of the SPA ends *our* session
  and therefore any further hand-off, but an already-open WHMCS session lives until WHMCS expires it or the
  customer signs out there. See §7.
- **Writes of any kind.** `WHMCS_MODE` is `read-only`; no order, payment or provisioning call is implemented, and
  none may be enabled without staging verification and explicit authorisation.

---

## 7. One identity (B5.1)

The SPA owns the login; WHMCS owns billing. B5.1 makes them the same customer **without** either side learning the
other's password. WHMCS provides exactly one mechanism for this — `CreateSsoToken` — and this section documents how
it is used and what it deliberately does not do.

### Endpoints

| Method + path | What it does | Failure it can return |
| --- | --- | --- |
| `GET /api/v1/account/whmcs` | Reports `configured`, `mode`, whether the account is linked, the allowed destinations, and whether MFA is required/enabled. | `401` unauthenticated |
| `POST /api/v1/account/whmcs/link` | Looks up the WHMCS client whose email equals the caller's **verified** account email and stores the link. Idempotent. | `409` unverified / no match / ambiguous / already linked, `404` no client, `503` not configured |
| `DELETE /api/v1/account/whmcs/link` | Removes the link. Requires the account password. | `403` wrong password, `404` not linked |
| `POST /api/v1/account/whmcs/sso` | Mints a 60-second single-use token and returns WHMCS's prepared redirect URL. Body: `{ "destination": "invoices" }`, optional. | `400` unknown destination, `403` MFA missing or support session, `409` not linked, `429` throttled, `502` unsafe redirect, `503` not configured |

Allowed destinations (`clientarea`, `profile`, `services`, `domains`, `invoices`, `tickets`) map to WHMCS scope names
on the server. The request never carries a scope, a URL or a client id.

### The rules, and where they are enforced

| Rule | Enforced in |
| --- | --- |
| The client id comes from `whmcs_client_links` for the authenticated `user_id`; there is no parameter that could aim a hand-off at another customer | `sso.ts#mintSsoHandoff`, route handler |
| One account ↔ one client each way (`user_id` PK, `whmcs_client_id` UNIQUE) | migration `0087` |
| Linking needs a verified CloudHost247 address *and* an exact, unambiguous WHMCS email match | `sso.ts#linkWhmcsClient`, `resolveClientByEmail` |
| The token is never stored, logged or reused; only an audit row (who, which client, when, expires_at) is written | `sso.ts#mintSsoHandoff`, `0087` |
| The redirect must be an absolute URL on the configured WHMCS origin, or the hand-off is refused | `sso.ts#assertSafeSsoRedirect` |
| An admin support session cannot mint a hand-off | `routes/account-whmcs.ts#assertNotSupportSession` |
| The response is `Cache-Control: no-store` | `routes/account-whmcs.ts` |
| Replay is bounded by WHMCS single-use/60 s **and** by a per-account budget of 10 hand-offs per 5 minutes, enforced across instances | `sso.ts#consumeHandoffBudget` (atomic upsert in `0088`) + route rate limit |

### The MFA question (read this before setting `WHMCS_SSO_REQUIRE_MFA=false`)

WHMCS documents that the SSO redemption endpoint "will not attempt to enforce captcha or 2FA authorization controls
common to the WHMCS login form." A trusted token is therefore a *second-factor bypass* on the WHMCS side.

The default policy closes that hole from our side: a hand-off is refused unless the customer has MFA enabled on the
CloudHost247 account that is asking for it, so the second factor is satisfied before the token exists. Because a login
token is only issued after MFA, an SSO hand-off can never be stronger than the login behind it — it is never weaker.

Setting `WHMCS_SSO_REQUIRE_MFA=false` removes that requirement. Only do that if every customer who can reach the
billing area either has MFA in WHMCS or has accepted the downgrade in writing. The setting is parsed strictly: a
typo throws `WHMCS_INVALID_CONFIG` at boot rather than quietly defaulting to `false`.

### Session lifetime and logout

See **§9** for the complete lifecycle table (logout, expiry, unlink, deletion, revocation) and for the one thing this
integration deliberately cannot do — end a WHMCS session. The short version: the hand-off URL is inert after 60
seconds, signing out of CloudHost247 stops *new* hand-offs, and an already-open WHMCS session must be ended in WHMCS.

### What is still not proven

B5.1 has been exercised end-to-end against a scripted WHMCS and a real embedded Postgres; it has **not** been run
against a live installation. Until C1 supplies staging credentials, the untested parts are: the exact
`GetClients` payload shape of the target WHMCS version, whether that install's System URL matches
`WHMCS_BASE_URL` (the redirect-origin check will refuse the hand-off if it does not), and whether the customer's
SSO setting is enabled at all (`WHMCS_SSO_BLOCKED`). None of these can be closed by reasoning — they need the
read-only credential.

---

## 8. The orderability endpoint (B2.4)

`GET /api/v1/whmcs/orderability` and `GET /api/v1/whmcs/orderability/:serviceKey` are the **only** way a page may
learn that a service is for sale. They are anonymous, cached for 30 seconds at the edge, and answered from
`src/whmcs/orderability.ts`.

```json
{
  "configured": true,
  "mapValid": true,
  "currency": "USD",
  "generatedAt": "2026-11-08T10:00:00.000Z",
  "services": [
    {
      "serviceKey": "business-hosting",
      "state": "orderable",
      "orderable": true,
      "reasonCode": "ORDERABLE",
      "reason": "Available to order online.",
      "currency": "USD",
      "productId": "101",
      "productName": "Business Hosting",
      "cycles": [
        { "cycle": "monthly", "price": "12.50", "setupFee": "0.00", "currency": "USD",
          "cartUrl": "https://billing.example.com/cart.php?a=add&pid=101&billingcycle=monthly" }
      ]
    },
    {
      "serviceKey": "shared-hosting",
      "state": "not-integrated",
      "orderable": false,
      "reasonCode": "NOT_INTEGRATED",
      "reason": "This service is not available to order online yet.",
      "currency": null, "productId": null, "productName": null, "cycles": []
    }
  ]
}
```

### A service is orderable only when all four hold

1. it has a **binding** in `config/whmcs/product-map.json` (checksummed; a hand edit fails closed as `MAP_INVALID`);
2. the bound product is still returned by `GetProducts` and is not hidden;
3. WHMCS prices at least one of the binding's cycles **in the requested currency** (`-1` and `""` mean "not offered");
4. a cart URL can be built for that exact cycle from the same binding.

Today: **0 services are bound, so every service reports `NOT_INTEGRATED`.** That is the correct answer, not a
placeholder — see §6.

### Reason codes

| Code | State | Meaning |
| --- | --- | --- |
| `ORDERABLE` | orderable | All four conditions hold |
| `NOT_INTEGRATED` | not-integrated | No binding. Answered before anything environmental: it is the permanent truth |
| `WHMCS_DISABLED` | unavailable | This deployment has no WHMCS credentials |
| `MAP_INVALID` | unavailable | The map is missing, edited after sealing, or fails its checksum |
| `PRODUCT_NOT_IN_CATALOGUE` | unavailable | The bound product was deleted or hidden in WHMCS |
| `NO_CYCLES_OFFERED` | unavailable | The product sells none of the bound cycles in this currency |
| `CURRENCY_UNAVAILABLE` | unavailable | The requested currency is not configured on the install |
| `UPSTREAM_UNAVAILABLE` | unavailable | Timeout / breaker open / malformed response — retryable |

### What the request may and may not say

Accepted: `?services=a,b,c` (≤ 60 keys) and `?currency=USD` (three letters, must exist on the install).

Ignored by design: `pid`, `price`, `cycle`, `orderable`, `force`, and any other parameter. They are stripped by the
query schema and never reach the decision function, which takes the map, the catalogue and a service key — nothing
from the caller. A test (`cannot be talked into an orderable verdict by the client`) sends all of them at once and
asserts the answer is unchanged.

### Failure behaviour

A WHMCS outage, a missing install or a corrupt map always produces **HTTP 200 with per-service `unavailable` states**,
never a 500. A plan card without a buy button is honest; an error page on a marketing page is not. The catalogue cache
never stores a failure, and the circuit breaker in `client.ts` keeps the outage from costing one timeout per visitor.

### Still unproven

The endpoint has been tested against a sealed fixture map and a scripted WHMCS. What staging must confirm: the real
`GetProducts`/`GetProductGroups`/`GetCurrencies` payloads of the target version, and — the moment the first real
binding exists — that the cart URL it produces actually lands on the right product with the right cycle.

---

## 9. SSO lifecycle, revocation, and what we cannot control

Every row states what CloudHost247 can do, what WHMCS does, and — where they differ — which one wins. Copy, support
scripts and dashboards must not blur these lines.

| Event | CloudHost247 effect | WHMCS effect | Can we force it? |
| --- | --- | --- | --- |
| Hand-off minted | audit row + one unit of the rate budget | one 60-second single-use token exists | n/a |
| Hand-off URL used | nothing (we keep no token) | session created in the client area | no — and nothing to replay |
| 60 seconds pass | `expires_at` in the past, evidence only | token rejected | — |
| Customer logs out of the SPA | `jti` revoked; `authenticate()` rejects future calls; no further hand-offs | **session keeps running** | **no** — WHMCS has no session-termination API |
| Customer signs out of WHMCS | nothing | session ends | n/a |
| Hand-off refused for MFA | `403` before any token exists | nothing happens | yes, by policy (`WHMCS_SSO_REQUIRE_MFA`) |
| `DELETE /api/v1/account/whmcs/link` | link row deleted (password required) | **nothing** — client, services and invoices untouched | yes, on our side only |
| WHMCS client deleted or merged | next hand-off returns `WHMCS_SSO_LINK_STALE` (`409`) | `CreateSsoToken` answers `Invalid client_id` | no auto-repair: staff must relink or unlink |
| Customer disables SSO in their WHMCS security settings | next hand-off returns `WHMCS_SSO_BLOCKED` (`409`) | refuses the token | **no** — the customer's choice is final by design |
| Account suspended/disabled | `authenticate()` rejects (`401`) before any WHMCS call | nothing happens | yes |
| Account deleted | link row and hand-off audit rows cascade away | client remains | yes, on our side only |

### The two limits worth repeating in the UI

1. **"Sign out" does not sign the customer out of WHMCS.** There is no API for it. A "sign out everywhere" control would
   be a lie unless it says *exactly* what it clears, i.e. our session only.
2. **Unlinking is not cancellation.** It removes the way in; it does not stop billing, delete a service or close an
   invoice. Anything the customer reads about unlinking must say so, and point at support for the billing side.

### Revocation paths that are already tested

- A logged-out (revoked) token cannot mint a hand-off or read the link status — `authenticate()` checks
  `revoked_tokens` on every request.
- A support-session token cannot mint one (`403`), so an administrator's impersonation never escalates into the
  customer's billing account.
- A suspended account cannot mint one — the status check precedes the WHMCS call.
