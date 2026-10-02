# Security model

The module is a tool that makes outbound network requests on behalf of users,
which makes it a classic SSRF and abuse target. The controls below are enforced
in shared code (`Core/Security`, `Core/Http`, `Core/Runner`), not per tool, so a
new tool cannot forget them.

## Identity and permissions

* The client area uses the existing WHMCS session; every customer-scoped page and
  API call resolves the customer from the session or from the explicit
  `client_id` on an authenticated API call. A customer only ever sees their own
  domains, services, history, favourites and monitors.
* Domain shortcuts on WHMCS pages are built from the domain the customer is
  already viewing; they never accept a domain parameter from the browser.
* Admin actions require a valid admin session (`check_token('WHMCS.admin.default')`
  via `cloudhost247_core`'s `AdminGuard`) plus the capability
  `cloudhost247_network_tools:tools.manage`. When no capability row exists the
  guard falls back to "role passes", matching the rest of the repository.
* Every admin mutation is a `POST` with a CSRF token; the tools UI does the same
  (`generate_token('plain')` / `check_token()`).

## Input validation

`TargetValidator` is the single validation authority for hosts, domains, emails,
IPs, ports, port sets, URLs, ASNs, MACs, DKIM selectors, CIDRs, choices, integers
and free text. `ToolField` calls it for every registry field. Services call it
again for anything derived at runtime. There is no second, weaker path.

## Outbound requests

* Every server-side fetch goes through `HttpFetcher`
  (`Core/Http/HttpFetcher.php`), which uses the hardened transport from
  `cloudhost247_integrations` when available.
* Only `http` and `https`; credentials in a URL are rejected.
* Host, port and every resolved address are checked by `SsrfGuard` before the
  connection (see `ssrf-protection.md`) and pinned with `CURLOPT_RESOLVE` so a
  hostname cannot be re-pointed between the check and the connection.
* Redirects are never auto-followed: each hop is re-validated and re-pinned, up
  to the tool's limit.
* TLS peer and host verification are mandatory and may not be disabled by a
  caller; `test_static.py` fails the build on a `CURLOPT_SSL_VERIFYPEER => false`.
* Connect timeout, total timeout and response size are always applied; the body
  is capped while streaming.

## Secrets

* No table in this module has a column for a credential. Provider credentials
  stay in the `cloudhost247_integrations` `SecretVault` (AES-256-GCM) and are
  referenced by provider key.
* Submitted secrets (SMTP password, password tool value, email header body) are
  marked `sensitive` in the registry. The runner then skips the cache, leaves
  the history label empty, and the services state that nothing was stored.
  Logs, analytics, exports, support tickets and history record metadata only.
* `SecretPolicy::redact()` is applied to any row persisted through a repository,
  and the API never echoes a secret field back.

## Abuse protection

Rate limits per IP, per client, per tool-and-IP and per tool-globally
(`rate-limiting.md`), with stricter tiers for ping, traceroute, port checks,
crawls and HTTP fetches. Repeated failures feed `AbuseGuard`, which applies a
temporary block at `abuse_block_threshold` (default 5) failures and records an
audit event. The raw-ICMP, traceroute, socket and system-binary paths are gated
by `Capability` and are never simulated.

## What is deliberately not done

* No unbounded ping, traceroute, port scan or crawler: every such tool has a
  hard maximum (counts, ports, pages, links, runtime, bytes) enforced before the
  first probe.
* No SMTP credential logging, no storage of submitted passwords, email bodies or
  card numbers, and no hard-coded blacklist provider.
* No "secure" verdict from the mere presence of records; see `architecture.md`.
