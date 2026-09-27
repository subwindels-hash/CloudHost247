#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '== CloudHost247 release-candidate source verification =='
git diff --check
find modules/addons/cloudhost247_* modules/servers/cloudhost247_ovh tests -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null
php tests/foundation/run.php
php tests/currency/run.php
php -d display_errors=1 tests/ovh/run.php
python3 -m unittest -v tests/foundation/test_static.py tests/currency/test_static.py tests/ovh/test_static.py tests/ovh/test_product_services_static.py tests/security/test_security.py
python3 scripts/validate-migrations.py
grep -v '^#' docs/independent-rebuild/original-file-manifest.sha256 | sha256sum --check --strict >/dev/null
if grep -RIE --include='*.php' --include='*.tpl' --include='*.yml' '(BEGIN (RSA |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|application[_ -]?secret\s*[:=]\s*["'"'][^"'"']+)' modules/addons/cloudhost247_* modules/servers/cloudhost247_ovh templates/cloudhost247 templates/orderforms/cloudhost247; then echo 'Potential embedded secret detected' >&2; exit 1; fi
if grep -RIE "schema\(\)->(create|table|drop|rename)\('tbl" modules/addons/cloudhost247_*/migrations; then echo 'WHMCS core-schema modification detected' >&2; exit 1; fi
echo 'Release-candidate source verification passed.'
