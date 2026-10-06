# CloudHost247 Tools Center

A native DNS / IP / network / developer / webmaster / security / domain / productivity / diagnostics
tool suite, built into the existing platform. There is no separate website and no second account
system: the Tools Center reuses CloudHost247's authentication, RBAC, accounts, domains, DNS,
billing, support tickets, notifications, audit log, database and UI design language.

**64 tools** ship in this release (60 runnable + 4 portal pages). The authoritative list, with each
tool's page route and API endpoint, is generated from the code catalogue into
[TOOLS_CATALOG.md](./TOOLS_CATALOG.md).

## The rule that shapes everything here

**A tool never invents a result.**

* If a deployment cannot run a tool (no `ping` binary, no raw sockets, a blocked resolver), the tool
  says so and names the reason. It does not fall back to a plausible-looking answer.
* If a tool needs an external provider that is not configured, the answer is
  `CONFIGURATION_REQUIRED` with instructions for the administrator — not an empty success.
* If an upstream service refuses or blocks a query, that is reported as *refused/blocked*, never as
  "clean" or "broken".
* Every answer states the source it came from (`meta.sources`) and any caveat (`meta.warnings`).

This is why several tools look deliberately conservative. It is a product decision, not an
unfinished feature: on a hosting platform, a wrong answer about DNS or e-mail authentication costs a
customer more than no answer.

## What a customer sees

| Page | Route | Who |
| --- | --- | --- |
| Tools Center (search, categories, popular, recent, favorites, status) | `/tools` | everyone |
| Individual tool | catalogued path, e.g. `/tools/dns/propagation` | depends on the tool |
| Tool history | `/tools/history` | signed in |
| Favorites | `/tools/favorites` | signed in |
| Saved reports (export JSON/CSV/Markdown) | `/tools/reports` | signed in |
| Continuous monitoring (SSL expiry, DNS record, e-mail config) | `/tools/monitors` | signed in |
| Domain Health Center | `/domains/:domain/health` | signed in |
| Tools Center control center | `/admin/tools` | admin / super_admin |

A tool that requires an account is labelled **Sign-in required** on its card and on its page, and the
server enforces it again on every call — the badge is a courtesy, never the control.

## Sibling features under /tools

The Tools Center owns `/tools` and the catalogue paths beneath it. The **Document Tools** section
(ePassport MRZ calculator, validator and parser) is implemented by its own module and registered in
the catalogue as `mrz-generator`, with its public page at `/tools/mrz-generator` and the original
`/tools/document/mrz`, `/tools/document/mrz-parser` and `/tools/mrz-parser` URLs retained as
aliases. Its API is `/api/tools/mrz/*`; the executor path `POST /api/tools/mrz-generator` runs the
same engine with `cacheSeconds: 0`, no history target and report/ticket persistence refused
(see `docs/MRZ_DEVELOPER_TOOL.md`).

Because it is a catalogue entry, it appears everywhere a tool is supposed to: the Tools menu
(Featured and Developer groups), the directory and category navigation, the footer Tools column,
site search, the sitemap and the related-tools lists. Both shells read the same
`/api/tools/navigation` and the same generated projection, so the link cannot exist in one shell and
be missing in the other.

## Architecture

```
src/tools/
  catalog.ts              the catalogue: identity, route, auth, provider, limits, notes
  routes.ts               the whole /api[/v1]/tools/* surface
  handlers/               one module per tool family; pure translation between HTTP input and services
  core/
    errors.ts             ToolError + codes → HTTP status + retryability + the JSON envelope
    ssrf.ts               address classification, URL validation, guarded fetch, TCP connect
    dns-wire.ts           RFC 1035/3596/6891 encoder and parser (no resolver library)
    dns-client.ts         UDP/TCP/DoH query execution against the resolver registry
    resolvers.ts          resolver registry + health checks
    providers.ts          provider registry, encrypted credentials, health
    cache.ts              tool_cache read/write with per-tool TTLs
    rate-limit.ts         four limit scopes + abuse blocking
    registry.ts           catalogue + DB overrides → effective tools and statuses
    history.ts            history, favorites, reports
    executor.ts           the single execution funnel (status gate → limits → cache → run → log)
    capabilities.ts       what this deployment can actually do (binaries, sockets, TLS…)
    explain.ts            result explanations derived from the result itself
  <family>/               the actual diagnostic services (dns, ip, network, security, developer,
                          webmaster, domain, productivity, diagnostics)
  worker/sweep.ts         provider/resolver health sweeps + monitor evaluation
  domain/health.ts        the Domain Health Center aggregator
```

Every execution, from any entry point, funnels through `runTool` in `core/executor.ts`, so status
gating, abuse checks, rate limits, caching, history and execution logging behave identically no
matter which endpoint is called.

## Statuses

Each tool has an effective status, computed from the catalogue plus any operator override
(`tool_definitions` override row):

| Status | Meaning | What the API does |
| --- | --- | --- |
| `ACTIVE` | Runnable now | Runs |
| `DISABLED` | Switched off by an administrator | `503 SERVICE_UNAVAILABLE` |
| `MAINTENANCE` | Temporarily withdrawn, with an operator message | `503 SERVICE_UNAVAILABLE` |
| `CONFIGURATION_REQUIRED` | Needs a provider/credential the deployment lacks | `503 CONFIGURATION_REQUIRED` |
| `SERVICE_UNAVAILABLE` | Cannot work here (capability missing, no implementation) | `503` + reason |

The Tools Center shows the status on every card, so a customer learns *before* clicking whether a
tool can work on this deployment.

## Error codes

`src/tools/core/errors.ts` is the single mapping. Codes, their HTTP status and whether retrying is
sensible:

| Code | HTTP | Retryable | Typical cause |
| --- | --- | --- | --- |
| `INVALID_INPUT` | 400 | no | Missing/malformed field |
| `TARGET_BLOCKED` | 400 | no | Target is private, loopback or metadata (SSRF guard) |
| `ACCESS_DENIED` | 403 | no | Tool requires an account or a role the caller lacks |
| `DOMAIN_NOT_FOUND` | 404 | no | Domain does not resolve / is not registered |
| `NOT_FOUND` | 404 | no | Object does not exist (report, monitor, favorite) |
| `RATE_LIMITED` | 429 | yes | A rate-limit bucket is exhausted |
| `CONFIGURATION_REQUIRED` | 503 | no | Operator has not configured the required provider |
| `SERVICE_UNAVAILABLE` | 503 | yes | Tool disabled, or upstream temporarily unusable |
| `CAPABILITY_UNAVAILABLE` | 503 | no | This deployment cannot do it (e.g. no ICMP) |
| `PROVIDER_ERROR` | 502 | yes | External provider errored or answered unusably |
| `DNS_LOOKUP_FAILED` | 502 | yes | No resolver could answer |
| `TIMEOUT` | 504 | yes | Operation exceeded its budget |
| `INTERNAL_ERROR` | 500 | yes | Unexpected server fault (logged with the tool slug) |

## Response envelope

Success:

```json
{
  "success": true,
  "tool": "dns-lookup",
  "status": "ACTIVE",
  "generatedAt": "2026-10-03T00:00:00.000Z",
  "data": { "...": "tool-specific, always real" },
  "meta": { "durationMs": 42, "cached": false, "sources": ["cloudflare 1.1.1.1"], "warnings": [], "historyId": "…" }
}
```

Failure:

```json
{ "success": false, "code": "CONFIGURATION_REQUIRED", "message": "…what to do about it…", "retryable": false, "tool": "ip-blacklist" }
```

The SPA renders the failure code and message verbatim rather than collapsing them into a generic
error, because "an administrator must configure a provider" and "you are being rate limited" need
different actions.

## Repository map

| Concern | Where |
| --- | --- |
| Schema + seeds (categories, resolvers, providers, settings) | `database/migrations/0067_create_tools_center.sql` |
| API | `src/tools/routes.ts`, `src/routes/admin-tools.ts` |
| SPA pages | `frontend/src/pages/Tools*Page.tsx`, `ToolPage.tsx`, `DomainHealthPage.tsx`, `AdminToolsPage.tsx` |
| SPA API client + per-tool form schemas | `frontend/src/lib/tools-api.ts` |
| Styles | `frontend/src/tools-center.css` |
| Tests | `tests/integration/tools-api.test.ts`, `tests/unit/tools-dns-wire.test.ts`, `frontend/tests/unit/tools-center-page.test.tsx` |
| Local preview (no PostgreSQL needed) | `scripts/tools-preview-server.ts` |
| Generated catalogue doc | `scripts/generate-tools-catalog-doc.ts` → `docs/tools/TOOLS_CATALOG.md` |

Companion documents: [TOOLS_CATALOG.md](./TOOLS_CATALOG.md) · [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) ·
[API.md](./API.md) · [SECURITY.md](./SECURITY.md) · [OPERATIONS.md](./OPERATIONS.md)
