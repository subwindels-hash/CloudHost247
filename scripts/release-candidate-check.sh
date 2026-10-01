#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '== CloudHost247 release-candidate source verification =='
# Some language overrides are intentionally CRLF; ignore only the carriage return in a CRLF line ending.
git -c core.whitespace=cr-at-eol diff --check
find modules/addons/cloudhost247_* modules/servers/hostx_email modules/servers/cloudhost247_ovh modules/servers/cloudhost247_smm modules/servers/RDP tests scripts crons/cloudhost247_*.php builder-page.php cloudhost247-page.php aboutus.php all-element-cloudhost247.php blog.php cloudhost247-sample.php cloudhost247-vps-sample.php comingsoon.php cpanel-hosting.php data-protection-standards.php dedeicated-server.php dedicated-server.php developer-friendly.php domain.php enterprise-servers.php future-element.php game-servers.php help-center.php legal-notice.php notfound.php offers.php plesk-hosting.php refund-and-cancellation-policy.php refund-policy.php ssl-certificate.php tables.php terms-of-service.php vps-hosting.php vps-privatecloud.php vps-publiccloud.php web-hosting.php website-design.php windows-hosting.php wordpress-hosting.php -name '*.php' -print0 | xargs -0 -n1 php -l
php tests/foundation/run.php
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
python3 -m unittest -v tests/foundation/test_static.py tests/currency/test_static.py tests/ovh/test_static.py tests/ovh/test_product_services_static.py tests/ovh/test_public_catalog_static.py tests/rdp/test_static.py tests/integrations/test_static.py tests/modules/test_static.py tests/builder/test_static.py tests/smm/test_static.py tests/tools/test_static.py tests/broker/test_static.py tests/cart_recovery/test_static.py tests/passkey/test_static.py tests/security/test_security.py tests/security/test_archive_integration.py
python3 -m unittest -v tests/staging/test_staging_tools.py
python3 -m py_compile scripts/validate-migrations.py scripts/compare-financial-evidence.py scripts/generate-staging-report.py
python3 scripts/validate-migrations.py
override_list='docs/independent-rebuild/rebrand-overrides.list'
override_hashes='docs/independent-rebuild/rebrand-overrides.sha256'
original_manifest='docs/independent-rebuild/original-file-manifest.sha256'
filtered_manifest=$(mktemp)
list_paths=$(mktemp)
hash_paths=$(mktemp)
trap 'rm -f "$filtered_manifest" "$list_paths" "$hash_paths"' EXIT
awk 'NF && $0 !~ /^#/ { print }' "$override_list" | sort > "$list_paths"
awk 'NF && $0 !~ /^#/ { print $2 }' "$override_hashes" | sort > "$hash_paths"
diff -u "$list_paths" "$hash_paths"
awk 'FNR==NR { if (NF && $0 !~ /^#/) excluded[$0]=1; next } NF && $0 !~ /^#/ && !($2 in excluded) { print }' \
    "$override_list" "$original_manifest" > "$filtered_manifest"
sha256sum --check --strict "$filtered_manifest" >/dev/null
grep -v '^#' "$override_hashes" | sha256sum --check --strict >/dev/null
# Embedded-secret and core-schema policies are enforced by test_security.py and validate-migrations.py.
echo 'Release-candidate source verification passed.'
