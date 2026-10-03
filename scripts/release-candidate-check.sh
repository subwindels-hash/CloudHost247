#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '== CloudHost247 release-candidate source verification =='

original_manifest='docs/independent-rebuild/original-file-manifest.sha256'

# Some language overrides are intentionally CRLF; ignore only the carriage return in a CRLF line ending.
git -c core.whitespace=cr-at-eol diff --check

# --- PHP syntax check -------------------------------------------------------------------------
# Every PHP file this repository owns is linted, plus the addon templates that are really PHP
# (modules/*/templates/**/*.tpl carrying a <?php tag are executed by WHMCS). The target list is
# computed by scripts/php-lint-targets.sh rather than hand-kept here and in the CI workflow, so
# the two gates cannot drift and a new module is linted the moment it exists. That script records
# the three exclusions and their reasons; tests/security/test_release_gate_static.py pins the
# partition and fails if an exclusion is added silently or a stated reason goes stale.
mapfile -t php_lint_targets < <(bash scripts/php-lint-targets.sh)
# Anti-vacuity guard: if the exclusion logic ever swallows the list, fail loudly instead of
# reporting a green gate that linted nothing.
if [ "${#php_lint_targets[@]}" -lt 700 ]; then
  echo "Release-candidate FAILED: only ${#php_lint_targets[@]} PHP lint targets resolved (expected 700+)." >&2
  exit 1
fi
printf '%s\n' "${php_lint_targets[@]}" | xargs -r -n1 php -l

# --- Module behavioural suites (PHP) -----------------------------------------------------------
php tests/foundation/run.php
php -d display_errors=1 tests/theme/run.php
php tests/currency/run.php
php -d display_errors=1 tests/smm/run.php
php -d display_errors=1 tests/tools/run.php
php -d display_errors=1 tests/ovh/run.php
php -d display_errors=1 tests/rdp/run.php
php -d display_errors=1 tests/integrations/run.php
php -d display_errors=1 tests/modules/run.php
php -d display_errors=1 tests/builder/run.php
php -d display_errors=1 tests/broker/run.php
php -d display_errors=1 tests/marketing/run.php
php -d display_errors=1 tests/cart_recovery/run.php
php -d display_errors=1 tests/passkey/run.php
php -d display_errors=1 tests/phoneservices/run.php
php -d display_errors=1 tests/customaffiliate/run.php
php -d display_errors=1 tests/cloudhost247_email/run.php
php -d display_errors=1 tests/payments/run.php

# --- Server agent (Node) -----------------------------------------------------------------------
# The agent is the only component that touches Docker on a customer's server, and its HMAC
# verification, skew window and replay cache are the entire boundary between the control plane and
# that machine. It shipped with no tests at all until 2026-10-03. Its protocol exists twice by
# design (server-agent/src/auth.js and cloudhost247-node/src/deployments/agent-protocol.ts,
# because the agent must run dependency-free on a customer host) and the two files must be
# changed together — so the cross-implementation conformance suite in the Node platform
# (tests/integration/agent-protocol-conformance.test.ts) is what proves they are one protocol.
#
# Node is required rather than optional: a silent skip here would make "releasable" mean something
# different on a machine without Node, which is the drift the shared lint-target list exists to
# prevent.
if ! command -v node >/dev/null 2>&1; then
  echo 'Release-candidate FAILED: node is required to run the server-agent authentication suite.' >&2
  echo 'Install Node >= 20 (see server-agent/package.json "engines").' >&2
  exit 1
fi
node --test server-agent/tests/*.test.js

# --- Static verification (runs without PHP or WHMCS) -------------------------------------------
python3 -m unittest -v tests/foundation/test_static.py tests/theme/test_static.py tests/currency/test_static.py tests/marketing/test_static.py tests/ovh/test_static.py tests/ovh/test_product_services_static.py tests/ovh/test_public_catalog_static.py tests/rdp/test_static.py tests/integrations/test_static.py tests/modules/test_static.py tests/builder/test_static.py tests/smm/test_static.py tests/tools/test_static.py tests/broker/test_static.py tests/cart_recovery/test_static.py tests/passkey/test_static.py tests/digitalproducts/test_static.py tests/payments/test_static.py tests/security/test_security.py tests/security/test_archive_integration.py tests/security/test_release_gate_static.py
python3 -m unittest -v tests/staging/test_staging_tools.py
python3 -m py_compile scripts/validate-migrations.py scripts/compare-financial-evidence.py scripts/generate-staging-report.py scripts/branding-audit.py
python3 scripts/validate-migrations.py
# Repository-wide retired-brand search. The vendor theme-helper addon has been
# retired, so the tolerated count is zero: any new occurrence of the retired
# brand fails the release candidate outright.
python3 scripts/branding-audit.py --quiet

# --- Vendor integrity baseline ------------------------------------------------------------------
# Strict and total: no path is exempted, so any edit to a vendor-derived file fails here. The
# baseline records the rebranded state and is re-cut deliberately (with a dated reason in the
# manifest header) when a vendor file must change — there is no side-car override manifest.
# --quiet prints only the failures, so a red gate names the drifted paths.
if ! sha256sum --check --strict --quiet "$original_manifest"; then
  echo 'Release-candidate FAILED: the tree does not match the vendor integrity baseline above.' >&2
  echo 'Restore the listed file(s), or re-cut the baseline deliberately and record the reason in' >&2
  echo 'the manifest header and docs/BRANDING-COMPATIBILITY.md.' >&2
  exit 1
fi
# Embedded-secret and core-schema policies are enforced by test_security.py and validate-migrations.py.
echo 'Release-candidate source verification passed.'
