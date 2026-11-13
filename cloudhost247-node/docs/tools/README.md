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

### Barcodes, labels and cards

Six tools make print artwork instead of answering a question: **Barcode Generator**
(`/tools/barcode-generator`), **Online Label Printing** (`/tools/label-designer`), **VDA 4902 Label
Generator** (`/tools/vda-4902-label-generator`), **Shipping Label Generator**
(`/tools/shipping-label-generator`), **QR Code Business Cards**
(`/tools/qr-business-card-designer`) and **QR Code Maker** (`/tools/qr-code-maker`). They are
ordinary catalogue entries, run through the same executor (`POST /api/tools/<slug>`), and differ
from the other tools in three ways:

* **The result is files, not fields.** `data` is `{ studio: true, title, previews, files, facts,
  notices, count }`: SVG previews at true physical size, the print files as base64 (PDF always; SVG,
  PNG, ZIP or `.vcf` depending on the tool), the facts worth checking (what each barcode carries, its
  module width, the stock) and the notices to read before printing. The SPA shows this with
  `StudioResult`; the raw response is never rendered.
* **What is entered is not stored or cached.** All six have `cacheSeconds: 0` and are in
  `NON_PERSISTABLE_TOOL_SLUGS` (no saved report, no ticket attachment), because a shipping label or
  a business card is an address and a phone number. History and the execution log record that the
  tool ran and the kind of artwork made (a barcode type, a template, a label size), and a refusal's
  message names the field at fault without repeating its value.
* **They refuse instead of adjusting.** Artwork is never scaled, rotated or clipped to fit a sheet,
  and a barcode is never drawn finer than its floor. A request that cannot be met is a
  `400 INVALID_INPUT` whose message gives the sizes involved, with `detail.reason` one of
  `LABEL_EXCEEDS_CELL`, `LABEL_EXCEEDS_PAGE`, `GRID_EXCEEDS_PAGE`, `INVALID_GEOMETRY`,
  `TOO_MANY_PAGES`, `LABEL_TOO_SMALL`, `CODE_TOO_DENSE`, `size` or `data`.

They share one page component (`DesignStudioPage`, one route per slug) whose form comes from
`src/tools/design-studio/forms.ts`, the same description the general tool page and the embedded
build use. What was built, how it is tested and what has not been verified is recorded in
[DESIGN-STUDIO-PLAN.md](./DESIGN-STUDIO-PLAN.md) §12 and §13.

A seventh tool reads what they make. **Barcode Scanner** (`/tools/barcode-scanner`) decodes
twenty-one barcode types with a camera or from a picture. Its page decodes in the browser and
uploads nothing. It has two decoders:

* the full one, zxing-cpp compiled to WebAssembly (`frontend/src/lib/scan-engine.ts` loads it,
  `scan-cpp.ts` says what it is asked and how its answers are worded), which reads all twenty-one;
* the basic one, ZXing in plain JavaScript (`src/tools/scanner/decode.ts`), which reads thirteen.
  The page falls back to it in a browser that will not run WebAssembly, and says so.

`POST /api/tools/barcode-scanner` reads a barcode from an uploaded PNG with the basic decoder, so
the server loads no WebAssembly. The page may, because the Content-Security-Policy carries one word
for it, `'wasm-unsafe-eval'`: what that allows, what it does not, and how to withdraw it are in
[SECURITY.md](./SECURITY.md) §8. Both decoders report a barcode they both read in the same words:
the same type and the same text, including text beyond ASCII. What a barcode contains is reported
as text and never opened or followed. Scan results are in `NON_PERSISTABLE_TOOL_SLUGS` too.

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
| Barcode, label and card tools (engines, tools, forms) | `src/tools/design-studio/`, `src/tools/handlers/design-studio.ts` |
| Their page and result panel | `frontend/src/pages/tools/DesignStudioPage.tsx`, `frontend/src/components/tools/StudioResult.tsx` |
| Their tests | `tests/unit/design-studio-tools.test.ts`, `tests/unit/design-studio-barcodes.test.ts`, `tests/unit/design-studio-qr.test.ts`, `frontend/tests/unit/design-studio-page.test.tsx`, `e2e/design-studio.spec.ts` |
| Barcode Scanner (types, basic decoder, API) | `src/tools/scanner/{formats,decode,scan-image}.ts`, `src/tools/handlers/scanner.ts` |
| Barcode Scanner (page, full decoder) | `frontend/src/pages/tools/BarcodeScannerPage.tsx`, `frontend/src/lib/{scan-engine,scan-cpp,scan-session}.ts` |
| Its tests | `tests/unit/barcode-scanner.test.ts`, `tests/unit/barcode-scanner-engine.test.ts`, `frontend/tests/unit/barcode-scanner-page.test.tsx`, `e2e/barcode-scanner.spec.ts` |
| Local preview (no PostgreSQL needed) | `scripts/tools-preview-server.ts` |
| Generated catalogue doc | `scripts/generate-tools-catalog-doc.ts` → `docs/tools/TOOLS_CATALOG.md` |

Companion documents: [TOOLS_CATALOG.md](./TOOLS_CATALOG.md) · [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) ·
[API.md](./API.md) · [SECURITY.md](./SECURITY.md) · [OPERATIONS.md](./OPERATIONS.md)
