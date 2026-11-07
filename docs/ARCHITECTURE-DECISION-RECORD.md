# Architecture Decision Record — Canonical Node Backend

| Field | Value |
| --- | --- |
| ADR | **001 — Canonical Node platform** |
| Date | 2026-11-07 |
| Branch | `arena/1b329121-cloudhost247` |
| Status | **Accepted** (based on the route-by-route comparison in `docs/CANONICAL-BACKEND-COMPARISON.md`) |
| Decider | Project owner instruction (2026-11-07): "If `platform/` is the complete replacement, make it the canonical Node backend… do not develop the same features twice" |
| Supersedes | `platform/README.md`'s unqualified claim that it "replaces the Fastify/TypeScript `cloudhost247-node` stack" |

---

## Decision

**`cloudhost247-node/` is the canonical Node backend. `platform/` is frozen read-only for feature work. Nothing is deleted, renamed, migrated or rewritten.**

`platform/` is **not** the complete replacement. Its own `platform/MIGRATION.md` §"Deliberately deferred (open items)" lists real capabilities of the old platform that were not ported, and the independent route dump found **222 API endpoints that exist only in `cloudhost247-node/`** — including the entire website builder, AI website builder, online store, logo maker, expert services, marketing services, unified inbox and all AI/LLM integration. It also has no versioned SQL migration history, no shared-generator/WHMCS projection, and a 194-line SPA instead of 131 page components.

Therefore the conditional in the instruction ("*if* `platform/` is the complete replacement…") is not satisfied, and the switch must not happen.

## Evidence summary

| Signal | `cloudhost247-node/` | `platform/` |
| --- | --- | --- |
| Canonical `METHOD + path` routes | 722 | 616 |
| Shared / node-only / platform-only | 500 shared | **222 node-only**, 116 platform-only |
| Versioned SQL migrations | 83 (`0001`–`0083`) + checksummed runner + production quarantine | 0 (one generated schema, 127 tables) |
| Frontend | 131 page components / 190 routes | 1 `App.jsx` (194 lines) + ~40 static HTML pages |
| Shared registry → SPA + PHP/WHMCS projection | ✅ `scripts/site/generate.mjs` | ❌ generator has no reference to `platform/` |
| AI/LLM provider | ✅ OpenAI/Anthropic-compatible + ledger + fail-closed router | ❌ zero matches in `platform/src` |
| Provider adapters | ✅ 13 kinds | ✅ 12 kinds |
| Tests | 168 Vitest files | 74 `node:test` files / 876 tests (876/876 on two clean re-runs; 2 transient failures in one earlier run, not reproduced) |
| cPanel/WHMCS deployment path | ✅ `docs/CPANEL_DEPLOYMENT.md`, 84 PHP pages | ❌ only `.htaccess` + `TROUBLESHOOTING-503.md` |

Full per-route evidence: [`docs/audit/canonical-backend-route-comparison.csv`](audit/canonical-backend-route-comparison.csv) (838 rows). Full reasoning: [`docs/CANONICAL-BACKEND-COMPARISON.md`](CANONICAL-BACKEND-COMPARISON.md).

## Rules that follow from this decision

1. **All Phase 3–9 backend work lands in `cloudhost247-node/`.** No new domain modules, route modules, schemas, adapters or frontend pages in `platform/`.
2. **No duplicate services.** A capability already implemented in the canonical stack is not re-implemented in `platform/`, and vice versa. The P0 identifier-contract fix was applied **once**, in `cloudhost247-node/src/lib/identifier-contract.ts`; `platform/src/core/validate.js:218` already uses a version-agnostic UUID regex and never had the defect.
3. **Nothing is deleted.** `platform/` files, its 127-table schema, 60+ application manifests, PWA/service worker, Capacitor shells, gateway webhook parsers, in-tree WebAuthn and its tests stay in the repository. No data migration is performed.
4. **The old application stays read-only during the transition.** Because there is no switch, the read-only tree is `platform/`. It is retained as a tested parallel implementation and as a source of capabilities to absorb.
5. **Convergence is a separate, explicitly authorised project.** Before any future switch, this parity gate must be satisfied:
   - `docs/audit/canonical-backend-route-comparison.csv` regenerated with **0 node-only and 0 platform-only** routes;
   - both test suites green (canonical Vitest suite sharded rather than one 900 s run; `platform/` `node --test tests/*.test.js`);
   - `scripts/site/generate.mjs` projecting nav/design into the chosen frontend **and** the WHMCS theme;
   - versioned, checksummed migrations with the quarantine rules preserved;
   - a licensed WHMCS 8.x + cPanel staging verification (see `docs/STAGING-ENVIRONMENT-REQUIREMENTS.md`);
   - a written cutover/rollback plan with no data loss and no service duplication.
6. **Documentation correction.** `platform/README.md`'s supersession sentence is qualified in place with a pointer to the comparison, so no one acts on a stale assertion. No functional code in `platform/` was modified.
7. **Financial freeze unchanged.** The canonical stack's quarantined migrations `0023`/`0024`/`0025`/`0041` remain quarantined; webhooks and gateways remain inactive; no production payment setting is touched.

## Consequences

- **Positive:** one place to implement currency, builder, AI, domains, billing and control-panel work; the WHMCS/PHP ↔ Node generator contract stays intact; the 83-migration audit trail and production quarantine remain authoritative; no working customer functionality is sacrificed.
- **Negative / accepted:** `platform/` capabilities that are unique (zero-dependency core, PWA/mobile shells, crawlable static public HTML, 60+ app manifests, in-tree WebAuthn, Stripe/PayPal/Paystack inbound webhooks) are not available in the canonical stack today. They are recorded in the comparison as **to absorb**, not to rebuild twice.
- **Risk:** `platform/README.md` still describes an intended end state. Mitigated by the in-place qualification and this ADR.
- **Cost:** any future switch becomes a deliberate migration project rather than an implicit side effect.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Make `platform/` canonical now and port the 222 missing routes later | Would delete working builder/AI/store/customer surfaces, break PHP/WHMCS consistency, discard checksummed migrations/quarantine, and violate "do not sacrifice existing working functionality". |
| Run both stacks actively and develop features in both | Explicitly forbidden: "Do not develop the same features twice." |
| Delete `platform/` | Explicitly forbidden: "Do not delete existing functionality, migrations, data, or integrations." |
| Merge the two trees mechanically | No shared storage contract (JSON store vs 83 SQL migrations), no shared generator, no shared test harness; a mechanical merge would create exactly the duplication the brief forbids. |

## Review triggers

Reopen this ADR when (a) the parity gate above is met, (b) a licensed WHMCS/cPanel staging environment exists, or (c) the project owner explicitly instructs a switch despite the parity gap.
