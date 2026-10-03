# Tools Center — HTTP API

Base path: `/api/tools/...`. Every route is also registered under `/api/v1/tools/...` — the platform
serves both aliases for backwards compatibility, and they are literally the same handlers.

Authentication uses the platform's existing bearer token (`Authorization: Bearer <jwt>`); there is no
separate Tools Center credential. Tools marked `authRequired` in the catalogue use
`authenticate()`, everything else runs anonymously when `tools.anonymous_access` is on.

## Envelopes

Success (HTTP 2xx):

```json
{
  "success": true,
  "tool": "ssl-checker",
  "status": "ACTIVE",
  "generatedAt": "2026-10-03T00:00:00.000Z",
  "data": { },
  "meta": {
    "durationMs": 812,
    "cached": false,
    "sources": ["tls handshake to example.com:443"],
    "warnings": ["The certificate expires in 21 days."],
    "historyId": "0f0a…"
  }
}
```

Failure (non-2xx, body always JSON):

```json
{ "success": false, "code": "TARGET_BLOCKED", "message": "169.254.169.254 is link-local / cloud metadata and cannot be queried.", "retryable": false, "tool": "http-headers" }
```

`code` is one of the typed codes in `src/tools/core/errors.ts` — see
[README.md](./README.md#error-codes) for the code → HTTP status → retryability table. Validation
failures raised by the platform's Zod layer also surface as `422` with a field-level message.

## Discovery

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/tools/catalog` | none | Every effective tool with status, category, route, provider and limits. `?category=dns` filters (and rejects an unknown category with 400 rather than returning an empty list). |
| GET | `/tools/dashboard` | optional | Catalogue summary plus `popular`, `recent` and `favorites` for the caller. |

## Execution

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/tools/:slug` | per tool | Run a tool. Body is the tool input; `{"refresh":true}` bypasses the cache. |
| GET | `/tools/:slug` | per tool | Run a read-only tool with query-string input. Calling a POST-only tool this way returns `INVALID_INPUT` explaining why. |
| POST | `/tools/:slug/explain` | per tool | Run the tool and return the result plus a derived explanation (`whatThisMeans`, `whatToCheckNext`, `limitations`, `confidence`). |
| POST | `/tools/:slug/report` | session | Run the tool and save the result as a report for the caller. |
| POST | `/tools/:slug/ticket` | session | Run the tool and open a support ticket containing the verbatim result. `note` adds customer context. |

`/tools/:slug` is the canonical form, and matches the catalogue's `apiPath`. Portal pages
(`tool-history`, `tool-favorites`, `tool-reports`, `tool-monitors`) are **not** executable: calling
them returns `404` with a message pointing at the page and at the endpoints that do expose their data.
That check happens *before* authentication on purpose — a portal page is not a protected tool, it is
not a tool at all.

Example:

```bash
curl -s https://host/api/tools/dns-lookup?name=example.com\&type=A
curl -s -X POST https://host/api/tools/json-tools \
  -H 'content-type: application/json' \
  -d '{"operation":"format","text":"{\"b\":1,\"a\":2}","sortKeys":true}'
```

## History, favorites, reports

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tools/history` | Caller's runs. `?limit`, `?offset`, `?tool=<slug>`. |
| DELETE | `/tools/history` | Clear the caller's history. |
| DELETE | `/tools/history/:id` | Delete one entry. |
| GET | `/tools/favorites` | Caller's favorites, resolved to full tool objects. |
| POST | `/tools/favorites` | `{"slug":"dns-lookup"}`, idempotent. |
| DELETE | `/tools/favorites/:slug` | Remove one. `404` when it was not a favorite. |
| GET | `/tools/reports` | Saved reports. `?limit`, `?offset`, `?tool`. |
| GET | `/tools/reports/:id` | One report (owner only — another account gets `404`, never `403`, so it cannot probe for existence). |
| GET | `/tools/reports/:id/export` | `?format=json|csv|markdown` — a file download with the correct filename. |
| DELETE | `/tools/reports/:id` | Delete a report. |

## Monitoring

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tools/monitors` | Monitors plus recent change events. `?monitorId`, `?limit`. |
| POST | `/tools/monitors` | `{"kind":"SSL_EXPIRY"|"DNS_RECORD"|"EMAIL_CONFIG","target":"…","recordType":"A","expectedValue":"…","matchMode":"exact"|"contains"|"regex"}` |
| PATCH | `/tools/monitors/:id` | `{"enabled":false}` and/or `expectedValue` / `matchMode`. |
| DELETE | `/tools/monitors/:id` | Remove a monitor. |
| POST | `/tools/monitors/:id/check` | Evaluate now. Returns the evaluation and, when one was raised, the notification. |

## Speed test

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/tools/speed-test/latency` | Tiny no-store response for RTT sampling. |
| GET | `/tools/speed-test/download?bytes=N` | Incompressible payload, clamped to `tools.speed_test_max_bytes` (and a 16 MB process ceiling). |
| POST | `/tools/speed-test/upload` | Accepts `application/octet-stream` (or `{"payload":"<base64>"}`), reports the received size, discards the body. |
| GET | `/tools/speed-test/config` | The caps, endpoints and rules the browser test must follow, plus (only when requested) the optional server-egress measurement. |

The browser measures the *visitor's* connection. `serverEgress` is a separate, clearly labelled
measurement of the server's own link, available only when a `SPEED_TEST` provider is configured.

## Domain Health Center

`POST /api/tools/domain-health` with `{"domain":"example.com"}` runs the aggregator directly and
returns per-section verdicts (dns, email-auth, dnssec, tls, hosting, monitoring) with evidence. The
same code backs the `/domains/:domain/health` page.

## Admin (admin / super_admin only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/tools/overview` | Metrics, catalogue breakdown, provider health, resolver health, abuse summary. |
| GET | `/admin/tools/tools` | Every tool with effective values and whether an override exists. |
| PATCH | `/admin/tools/tools/:slug` | Upsert an override (see [ADMIN_GUIDE.md](./ADMIN_GUIDE.md#2-tool-overrides)). |
| DELETE | `/admin/tools/tools/:slug/override` | Reset to catalogue defaults. |
| GET | `/admin/tools/providers` | Provider views (never credentials). |
| PUT | `/admin/tools/providers/:slug` | Save endpoint/credentials/enabled/priority. Credentials are encrypted; a missing key ring yields `CONFIGURATION_REQUIRED`. |
| POST | `/admin/tools/providers/:slug/test` | Real connection probe. |
| DELETE | `/admin/tools/providers/:slug` | Delete a provider configuration. |
| GET | `/admin/tools/resolvers` | Resolver registry. |
| POST | `/admin/tools/resolvers` | Add a resolver. |
| PATCH | `/admin/tools/resolvers/:id` | Update a resolver. |
| DELETE | `/admin/tools/resolvers/:id` | Remove a resolver (the default set can be re-seeded from migration 0067's `ON CONFLICT` seeds). |
| POST | `/admin/tools/resolvers/:id/test` | Probe and record health. |
| POST | `/admin/tools/cache/clear` | Clear all cached results, or one tool's. |
| POST | `/admin/tools/capabilities/refresh` | Re-detect deployment capabilities. |
| POST | `/admin/tools/sweep` | Run the provider/resolver/monitor sweeps now. |
| POST | `/admin/tools/run-tools-sweep` | Run the combined sweep used by the worker. |
| GET | `/admin/tools/health-checks` | Recent `tool_health_checks` rows. |

Every admin mutation is audited (`TOOL_OVERRIDE_UPDATED`, `TOOL_OVERRIDE_RESET`, `TOOL_PROVIDER_SAVED`,
`TOOL_REPORT_SAVED`, `TOOL_TICKET_CREATED`, `TOOL_MONITOR_CREATED`, …) in the platform `audit_logs`.
