# CloudHost247 SMM Marketplace

WHMCS 8.9.x / PHP 7.4+ addon + provisioning module pair that turns WHMCS into
a reseller front-end for SMM (social media marketing) provider panels.

It supersedes the earlier single-provider prototype in
`modules/addons/smmaddon` + `modules/servers/smmprovisioning` (which remain in
the tree untouched; disable them when this module goes live).

## Components

| Path | Role |
| --- | --- |
| `modules/addons/cloudhost247_smm/` | Addon module: schema (versioned migrations), admin dashboard, provider/service/mapping management, order operations, automation engine, client-area "My SMM Orders" page |
| `modules/servers/cloudhost247_smm/` | Provisioning module: ConfigOptions (Target Link, Quantity), CreateAccount/Suspend/Unsuspend/Terminate, client-area service output, refill/cancel custom buttons |
| `crons/cloudhost247_smm.php` | Standalone CLI cron entry (same code as the AfterCronJob hook) |
| `tests/smm/` | Behavior suite (real logic against in-memory fakes + scripted provider responses) and static architecture/security suite |

## Architecture

- **Foundation reuse** — admin auth/CSRF (`AdminGuard`), audit trail
  (`AuditLogger`), logging with correlation ids (`Logger`), and the versioned
  migration runner all come from `modules/addons/cloudhost247_core`. No WHMCS
  core files are modified.
- **Adapter boundary** — providers speak the "Generic SMM Panel API v2"
  dialect (POST `key` + `action`: `services`, `add`, `status`, `balance`,
  `refill`, `refill_status`, `cancel`) through
  `Adapters\GenericSmmAdapter`. New dialects plug into `AdapterFactory`
  without touching the order core.
- **Transport hardening** — HTTPS-only endpoints, TLS verification, no
  redirect following (the key can never leak to a redirect target), bounded
  timeouts and response sizes, private/reserved IP rejection (SSRF guard).
- **Idempotent ordering** — one row per WHMCS service (unique index) plus an
  optimistic `awaiting → in_flight` claim. Repeated CreateAccount calls,
  cron runs and page refreshes return the recorded outcome; they never
  re-submit. Lost responses are marked for reconciliation — never blindly
  retried.
- **Status normalization** — provider spellings map to a fixed internal
  vocabulary (`pending/processing/in_progress/partial/completed/canceled/
  failed/refunded/unknown`); a verified terminal status is never overwritten
  by a contradictory response (conflicts are flagged for review instead).
- **Security** — API keys encrypted at rest (WHMCS `encrypt()`), never shown
  after save (masked hint only), redacted from every log line; admin actions
  require session + CSRF token + capability; client queries are
  ownership-scoped; page rendering performs zero provider API calls.

## Tables (all `mod_cloudhost247_smm_*`)

`providers`, `services`, `mappings`, `orders`, `order_events`, `api_log`,
`sync_history`, `locks`, `settings` — created additively by
`migrations/V100.php` (guarded, re-runnable, no core table is touched, no
foreign keys so history can never be cascade-deleted).

## Order lifecycle

```
WHMCS payment + provisioning approval
        │ CreateAccount (modules/servers/cloudhost247_smm)
        ▼
   awaiting_submission ──claim──▶ in_flight ──HTTP──▶ accepted
        ▲                                        │        │
        │ retry (admin only, blocked if a         │        ├─ provider refused ──▶ rejected
        │ provider order id exists)               │        └─ outcome unknown ───▶ uncertain
        │                                         │                                   │
        └─────────────────────────────────────────┘            reconciliation (verify only)
```

Suspend/Unsuspend pause status sync. Terminate ends the local lifecycle
without silently cancelling anything at the provider.

## Automation (cron)

Tasks, all bounded and overlap-locked (`mod_cloudhost247_smm_locks`):
status sync (default every 15 min), pending-submission drive, stale
in-flight sweep (→ uncertain), reconciliation (verify-only, hourly),
catalog sync (daily), log cleanup. Configure intervals in
**Addons → CloudHost247 SMM → Settings**. Either schedule
`crons/cloudhost247_smm.php` (recommended) or rely on the WHMCS cron hook.

## Tests

- `php tests/smm/run.php` — runs the real adapter, order state machine,
  status mapping, reconciliation, catalog diff, client-area gating and
  redaction logic against in-memory fakes and scripted JSON (a mocked
  provider, **not** a staging verification).
- `python3 -m unittest tests.smm.test_static` — architecture + security
  invariants (interface conformance, guards, escaping, migration policy).

Both are wired into `scripts/release-candidate-check.sh` and CI.

## Status

Implemented and unit/static-tested. **Not yet verified on a staging WHMCS
installation** — see `docs/build-notes/cloudhost247-smm/CAPABILITIES.txt`
for the required staging checklist before any production claim.
