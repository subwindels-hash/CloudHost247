# Tools Center — operations, deployment and testing

## Deployment

The Tools Center is part of the existing application; there is nothing extra to install or serve.

1. **Apply the migration** (creates `tool_*` tables, seeds 9 categories, 26 resolvers, 13 providers
   and the `tools.*` settings):

   ```bash
   npm run build          # tsc + vite
   npm run migrate        # node dist/database/migrate.js up
   npm run migrate:verify # checksums
   ```

   Migration `0067_create_tools_center.sql` is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO
   NOTHING`), so re-running it never duplicates resolvers or overwrites operator settings.

2. **Build and start** exactly as before — `npm run build`, then Passenger/cPanel starts
   `server.js`, which loads `dist/`. The SPA is served by the same process, and deep links such as
   `/tools/dns/propagation` are resolved by the SPA fallback handler.

3. **Run the worker** for health sweeps and monitors: `node dist/src/worker/main.js` (long-running)
   or `node dist/src/worker/main.js --once` from cron. The Tools Center adds two interval-gated
   tasks to the existing worker — provider/resolver health every 15 minutes, monitors every 5
   minutes — so no additional cron entry is required if the worker already runs.

4. **Environment**: the tools add no mandatory variables. `CREDENTIAL_ENCRYPTION_KEY` (32 bytes,
   hex or base64) is required *only* to store provider credentials; without it, saving a provider
   returns an actionable `CONFIGURATION_REQUIRED` and everything else works.

## Local preview without PostgreSQL

`scripts/tools-preview-server.ts` boots the *real* application (the same `buildApp` used in
production) against an in-memory PGlite database with every migration applied, serves the built SPA
from `public/`, and seeds two demo accounts:

```bash
npx tsx scripts/tools-preview-server.ts 3000
#   customer    demo@cloudhost247.test  /  demo-tools-247
#   super_admin admin@cloudhost247.test /  admin-tools-247
#   → http://localhost:3000/tools   and   http://localhost:3000/admin/tools
```

Build the SPA first (`npm run build:frontend`) and re-run after changing source. It is a development
harness only: data is in-memory, and the one header it relaxes (CSP `frame-ancestors`, so the app can
be embedded in a preview iframe) is relaxed **in that script**, never in `src/`.

Tools that need the network will report typed failures in an offline sandbox
(`TIMEOUT`/`DNS_LOOKUP_FAILED`/`CONFIGURATION_REQUIRED`); the pure tools (JSON, encoding, subnet
maths, passwords, colours, text, QR) work fully. That contrast is the point — it is the honest
behaviour the API is designed for.

## Capability checks before promising a feature

`src/tools/core/capabilities.ts` probes what the host actually allows: DNS over UDP, DNS over HTTPS,
TCP connect, TLS client, SMTP client, HTTP fetch, raw sockets, and the presence of `ping` /
`traceroute` binaries on `PATH`. On typical cPanel shared hosting:

| Capability | Typical shared hosting | Consequence |
| --- | --- | --- |
| `dns-udp`, `dns-doh` | available | DNS tool family works fully |
| `tcp-connect`, `tls-client`, `http-fetch`, `smtp-client` | available | Ports, SSL, headers, SMTP tester work |
| `icmp-ping` | usually unavailable | Ping runs over TCP and says so |
| `traceroute` | unavailable | Traceroute returns `CAPABILITY_UNAVAILABLE` with the reason |
| `raw-socket` | unavailable | Nothing depends on it; raw-socket features are refused, not faked |

`GET /api/admin/tools/capabilities/refresh` re-runs detection; the admin page displays the result so
the limitation is visible before a customer asks.

## Scheduled work

| Task | Interval | Function | Notes |
| --- | --- | --- | --- |
| Provider health sweep | 15 min | `providerHealthSweep` | Real probe per enabled provider; writes `tool_health_checks` and provider health columns. |
| Resolver health sweep | 15 min | `resolverHealthSweep` | `tools.resolver_health_batch` per cycle. |
| Monitor sweep | 5 min | `monitorSweep` | `tools.monitor_sweep_batch` per cycle; notifications delivered once per change/threshold. |

All three are exposed to admins as on-demand actions (`POST /api/admin/tools/sweep`), which is the
fastest way to verify an environment after a change.

## Monitoring the monitors

* `tool_health_checks` — provider and resolver history with latency and detail.
* `tool_monitor_events` — every change detected by a customer monitor, with previous/current values.
* `tool_execution_logs` — append-only execution record; `GET /api/admin/tools/overview` aggregates it
  into totals, per-tool volume, failure counts and average duration.
* `tool_abuse_events` — rate-limit and abuse-block events (`abuseSummary` aggregates the last 24 h by
  default).

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Every tool returns 503 `CONFIGURATION_REQUIRED` | `tools.enabled` false, or the tool needs a provider | Check Admin → Tools → Overview and the tool's status badge |
| DNS tools return `DNS_LOOKUP_FAILED` | No enabled resolver, or the host blocks outbound port 53 | Test a resolver from Admin → Tools → Resolvers; if the host blocks UDP/53, rely on DoH resolvers |
| Propagation shows one resolver `DEGRADED` | That resolver is slow or answering oddly | Test it; disable it if it stays degraded |
| ICMP/traceroute unavailable | Shared-hosting restrictions | Expected; capabilities page shows it, tools say so |
| Provider save fails with "no encryption key configured" | `CREDENTIAL_ENCRYPTION_KEY` unset | Set the key, redeploy, save again |
| Speed test caps look wrong | `tools.speed_test_max_bytes` / `_max_ms` | Adjust the setting; no restart needed |
| Monitor notifications not arriving | Worker not running | Run the worker (or `--once` from cron) |

## Tests

```bash
npm run typecheck                                   # tsc, server
npx tsc -p frontend/tsconfig.json --noEmit          # tsc, SPA
npx vitest run tests/integration/tools-api.test.ts tests/unit/tools-dns-wire.test.ts
```

What the suites cover:

* **`tests/unit/tools-dns-wire.test.ts`** (18 tests) — the DNS codec against hand-built RFC 1035 /
  3596 / 6891 messages: name compression and pointer loops, all supported record types, TXT
  chunking, EDNS(0) OPT handling, truncation flags, malformed-message rejection.
* **`tests/integration/tools-api.test.ts`** (33 tests) — the whole HTTP surface over a real
  migrated PGlite database: catalogue/status exposure and `/api/v1` mirroring, a handler for every
  runnable catalogue entry (and no orphans), pure tools with exact expected values, SSRF refusal,
  `CONFIGURATION_REQUIRED` for unconfigured providers, typed DNS failure, malformed input, portal
  slugs never executing, history/favorites/reports/monitors including ownership isolation, admin
  authorization, override → status change propagation, encrypted credential storage (secret never
  echoed), audit rows, and the speed-test endpoints including the operator cap.

`frontend/tests/unit/tools-center-page.test.tsx` covers the SPA side: the catalogue grid with an
honest "Needs setup" warning, a nested catalogue URL resolving to the right tool page, and a typed
failure being rendered verbatim rather than flattened into a generic error.

The whole suite (`npx vitest run`) exceeds 15 minutes in this repository and is best run per
directory (the last full sweep was: 63 unit files / 495 tests, 57 integration files, 28 frontend
files / 94 tests — all green). Run the two tool suites on every change to `src/tools/**`.

Regenerate the catalogue documentation after adding or changing a tool:

```bash
npx tsx scripts/generate-tools-catalog-doc.ts > docs/tools/TOOLS_CATALOG.md
```

## Adding a tool

1. Add a catalogue entry in `src/tools/catalog.ts` (slug, name, category, summary, description, icon,
   `path`, `apiPath: '/api/tools/<slug>'`, methods, `authRequired`, visibility, rate-limit profile,
   cache seconds, timeout, keywords, and honest `notes`).
2. Implement the handler in the matching `src/tools/handlers/*.ts` module and register it in
   `TOOL_HANDLERS` (with a `TOOL_TARGETS` entry so history and tickets name the real target).
3. If the tool needs a provider, declare `providerKind` and use `requireProvider`; never fabricate a
   result when it is missing.
4. Add a form schema to `frontend/src/lib/tools-api.ts` so the tool page renders inputs (tools
   without one fall back to the JSON editor).
5. Add at least one integration test — the coverage test in `tools-api.test.ts` fails if a runnable
   catalogue entry has no handler.
