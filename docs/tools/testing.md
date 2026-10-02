# Testing

Everything the platform promises is covered by tests that run without a database
or a network, plus the release gate for the parts that need a full install.

## Suites

| Suite | What it proves | How to run |
| --- | --- | --- |
| `tests/cloudhost247_network_tools/run.php` | Behaviour: result envelope, no-fabrication rule, validation, SSRF, rate-limit tiers, capability states, registry integrity, field validation, network maths, propagation matching, SPF/DMARC parsing, health roll-up, DNSSEC chain, IDN/Punycode, parsers, security tools, productivity tools, UI escaping, migration contract, deployment surface | `php tests/cloudhost247_network_tools/run.php` |
| `tests/cloudhost247_network_tools/test_static.py` | Structure and security invariants: files, PHP syntax (brackets/heredocs/short tags), no shell/eval, TLS verification impossible to disable, SSRF consulted and pinned, CSRF + capability on admin mutations, no default API token, rate limiter consulted, sensitive fields and their consequences, migration guards/namespace, catalogue/handler resolution, template escaping, print-view contract, cron CLI guard | `python3 -m unittest -v tests/cloudhost247_network_tools/test_static.py` |
| `tests/cloudhost247_network_tools/qr_selfcheck.js` | The browser QR encoder end to end: finder/timing/dark module, format-info BCH decoded back to the used mask and EC level, un-masking, de-interleaving, Reed–Solomon syndromes, byte-mode round-trip across versions 1–10 and all four EC levels | `node tests/cloudhost247_network_tools/qr_selfcheck.js` |
| `tests/staging/test_staging_tools.py` | Staging checks that need a configured installation (gated; skips when the environment is absent) | `python3 -m unittest -v tests/staging/test_staging_tools.py` |
| `scripts/validate-migrations.py` | Migration versioning, uniqueness, additive behaviour, namespace isolation, one `hasTable` guard per create | `python3 scripts/validate-migrations.py` |
| `scripts/release-candidate-check.sh` | The gate: `php -l` over the repository, every addon suite, the python invariants, the migration validator, the branding audit and the original-file manifest | `bash scripts/release-candidate-check.sh` |

## What each area of the spec maps to

* **Per-tool unit behaviour** — `run.php` sections 7–15 (network maths, DNS
  matching, email authentication, security and productivity tools).
* **Validation** — section 2 (`TargetValidator`) and section 6 (registry field
  validation).
* **Permissions** — section 5 (visibility, admin-only, sensitive input) plus the
  static assertions that admin mutations require the capability and a CSRF token.
* **Security / SSRF** — sections 3 and 16 and the static SSRF block.
* **Rate limiting** — section 4 (tiers and strictness ordering) and the static
  assertion that the runner consults the limiter.
* **Error states** — section 1 (envelope, codes, HTTP mapping, retryability) and
  the `CONFIGURATION_REQUIRED`/`SERVICE_UNAVAILABLE` paths exercised throughout.
* **Frontend** — the QR self-check (browser code), the template escaping and
  print contract in the static suite, and the CSS/JS contract assertions.
* **Capabilities** — section 4 and the capability table assertions.

## Conventions

* A test that needs the network, WHMCS or a database belongs in the staging
  suite, not in `run.php`; `run.php` must pass on a laptop with no internet.
* Never assert a fabricated value: if a behaviour depends on a live resolver,
  assert the *shape* and the *state* (a real failure code), not a value.
* New tool → new assertions in `run.php`, plus a registry entry so the integrity
  checks cover it automatically. New invariant → new test in `test_static.py`.
* The WhatsApp/support flows, monitors and cron paths are exercised from the
  staging suite because they need real WHMCS state.

## Continuous verification

`scripts/release-candidate-check.sh` is the definition of "verified": it fails
the release if `run.php` fails, if any static invariant regresses, if a
migration stops being guarded, or if a retired brand string appears anywhere.
