#!/usr/bin/env bash
# Prints every PHP lint target in this repository, one path per line, relative to the root.
#
# This is the single source of truth for "which PHP does the release candidate syntax-check".
# Both scripts/release-candidate-check.sh and .github/workflows/independent-foundation.yml call
# it, so the two gates cannot drift apart — that drift is how 199 first-party PHP files (all 27
# language overrides, 18 public policy pages, the Blockonomics gateway, the LTE-proxy server
# module, phoneservices, customaffiliate, digitalproducts, tools_center, dnschecker,
# cloudhost247_email and the superseded SMM prototypes) came to be linted by neither gate.
#
# The list is computed from the tree, not hand-kept: a new PHP file is linted the moment it
# exists. tests/security/test_release_gate_static.py pins the partition and fails if an
# exclusion is added silently, if a stated reason goes stale, or if the list collapses.
#
# Excluded, each for a recorded reason:
#   1. every path in docs/independent-rebuild/original-file-manifest.sha256 — the vendor-derived
#      integrity baseline. Those files are verified byte-for-byte by the release candidate, so
#      they cannot drift; syntax-checking frozen files adds noise, not assurance.
#   2. modules/addons/xtreme_currency_rates — ionCube-encoded vendor code. `php -l` cannot parse
#      an encoded file, and the module is superseded by cloudhost247_currency (inventory row B2).
#   3. modules/servers/Smtphosting — a third-party provisioning module this repository does not
#      modify. It is inactive and superseded by modules/servers/cloudhost247_email_hosting
#      (inventory row B8). Gating a release on syntax in code we neither own nor change would be
#      a self-inflicted outage; all 637 of its files were verified structurally balanced on
#      2026-10-02, and its six zero-byte vendor placeholders are inventory rows C1-C6.
set -euo pipefail
cd "$(dirname "$0")/.."

manifest='docs/independent-rebuild/original-file-manifest.sha256'
exclusions='^modules/addons/xtreme_currency_rates/|^modules/servers/Smtphosting/'

{
  # PHP files: every module, addon, gateway, language override, cron, script, suite and root
  # entry point (builder-page.php, cloudhost247-page.php, the policy pages, …).
  find . -name '*.php' \
    -not -path './.git/*' -not -path './vendor/*' -not -path './cloudhost247-node/*'
  # WHMCS addon templates that are really PHP: modules/*/templates/**/*.tpl files carrying a
  # <?php tag are executed, so they are linted like any other PHP source. Theme .tpl files under
  # templates/ are Smarty markup, not PHP.
  grep -rl --include='*.tpl' -e '<?php' modules || true
} \
  | sed 's|^\./||' \
  | grep -Ev "$exclusions" \
  | grep -vxFf <(awk '{print $2}' "$manifest" | grep -E '\.(php|tpl)$') \
  | sort -u
