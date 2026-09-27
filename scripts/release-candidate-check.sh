#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '== CloudHost247 release-candidate source verification =='
git diff --check
find modules/addons/cloudhost247_* modules/servers/cloudhost247_ovh tests scripts -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null
php tests/foundation/run.php
php tests/currency/run.php
php -d display_errors=1 tests/ovh/run.php
python3 -m unittest -v tests/foundation/test_static.py tests/currency/test_static.py tests/ovh/test_static.py tests/ovh/test_product_services_static.py tests/security/test_security.py
python3 -m unittest -v tests/staging/test_staging_tools.py
python3 -m py_compile scripts/validate-migrations.py scripts/compare-financial-evidence.py scripts/generate-staging-report.py
python3 scripts/validate-migrations.py
grep -v '^#' docs/independent-rebuild/original-file-manifest.sha256 | sha256sum --check --strict >/dev/null
# Embedded-secret and core-schema policies are enforced by test_security.py and validate-migrations.py.
echo 'Release-candidate source verification passed.'
