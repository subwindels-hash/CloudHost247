#!/usr/bin/env bash
# CloudHost247 — offline smoke test for the Ubuntu 24.04 VPS stack.
#
# Self-contained smoke test for the VPS deployment: verifies every artefact the
# provisioning script installs exists, is syntactically valid, and is free of
# the placeholder tokens that must be rendered before use.
#
# Run from the repo root, no root and no VPS required:
#   bash infrastructure/vps/tests/smoke-test.sh
#
# It does NOT install anything and does NOT touch the network. For live
# verification on the server use scripts/healthcheck.sh instead.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VPS_DIR="${REPO_ROOT}/infrastructure/vps"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }

echo "CloudHost247 VPS smoke test"
echo "repo: ${REPO_ROOT}"
echo

echo "[1] Required files exist"
required=(
  setup-ubuntu-24.04.sh
  README.md
  nginx/cloudhost247-whmcs.conf
  nginx/cloudhost247-node.conf
  nginx/snippets/security-headers.conf
  nginx/snippets/csp-whmcs.conf
  php/www.conf
  php/zz-cloudhost247.ini
  systemd/cloudhost247-node.service
  systemd/cloudhost247-worker.service
  scripts/install-whmcs.sh
  scripts/deploy.sh
  scripts/backup.sh
  scripts/restore.sh
  scripts/healthcheck.sh
  tests/smoke-test.sh
  tests/gate-test.sh
  tests/nginx-live-test.sh
  tests/deploy-migrate-test.sh
  cron/cloudhost247.cron
  logrotate/cloudhost247
  fail2ban/jail.local
)
for f in "${required[@]}"; do
  if [[ -s "${VPS_DIR}/${f}" ]]; then pass "${f}"; else fail "${f} missing or empty"; fi
done

echo
echo "[2] Shell scripts parse (bash -n)"
shell_scripts=(
  "${VPS_DIR}/setup-ubuntu-24.04.sh"
  "${VPS_DIR}/scripts/install-whmcs.sh"
  "${VPS_DIR}/scripts/deploy.sh"
  "${VPS_DIR}/scripts/backup.sh"
  "${VPS_DIR}/scripts/restore.sh"
  "${VPS_DIR}/scripts/healthcheck.sh"
  "${VPS_DIR}/tests/smoke-test.sh"
  "${VPS_DIR}/tests/tls-check-test.sh"
  "${VPS_DIR}/tests/gate-test.sh"
  "${VPS_DIR}/tests/nginx-live-test.sh"
  "${VPS_DIR}/tests/deploy-migrate-test.sh"
  "${VPS_DIR}/tests/setup-dry-run.sh"
  "${REPO_ROOT}/cloudhost247-node/scripts/package-vps.sh"
)
for f in "${shell_scripts[@]}"; do
  if bash -n "$f" 2>/dev/null; then pass "$(basename "$f") parses"; else fail "$(basename "$f") has a syntax error"; fi
done

echo
echo "[3] Scripts are executable and declare a shell"
for f in "${VPS_DIR}/setup-ubuntu-24.04.sh" "${VPS_DIR}/scripts/"*.sh "${VPS_DIR}/tests/"*.sh; do
  [[ -x "$f" ]] && pass "$(basename "$f") is executable" || fail "$(basename "$f") is not executable (chmod +x)"
  head -n 1 "$f" | grep -q '^#!/usr/bin/env bash' || fail "$(basename "$f") missing '#!/usr/bin/env bash' shebang"
done

echo
echo "[4] Nginx vhosts reference PHP 8.2, not 8.3"
if grep -q 'php8.2-fpm.sock' "${VPS_DIR}/nginx/cloudhost247-whmcs.conf"; then
  pass "WHMCS vhost uses the PHP 8.2 FPM socket"
else
  fail "WHMCS vhost does not use /run/php/php8.2-fpm.sock"
fi
if grep -qE 'php8\.3|php8-3' "${VPS_DIR}/nginx/"*.conf "${VPS_DIR}/php/"*; then
  fail "a config references PHP 8.3 (WHMCS 8.x does not support it)"
else
  pass "no config references PHP 8.3"
fi

echo
echo "[5] Node vhost proxies to the systemd port (127.0.0.1:3000)"
if grep -q 'proxy_pass http://127.0.0.1:3000' "${VPS_DIR}/nginx/cloudhost247-node.conf"; then
  pass "proxy_pass → 127.0.0.1:3000"
else
  fail "Node vhost does not proxy to 127.0.0.1:3000"
fi
grep -q 'X-Forwarded-Proto' "${VPS_DIR}/nginx/cloudhost247-node.conf" \
  && pass "X-Forwarded-Proto forwarded (trustProxy)" \
  || fail "X-Forwarded-Proto not forwarded"

echo
echo "[6] systemd units are consistent with the deploy layout"
grep -qE 'ExecStart=/usr/bin/node (--[a-z-]+=[0-9]+ )?dist/src/server\.js' "${VPS_DIR}/systemd/cloudhost247-node.service" \
  && pass "node unit starts the compiled entrypoint (dist/src/server.js)" \
  || fail "node unit does not start dist/src/server.js"
# The cPanel Passenger bootstrap is retired: the deployment is VPS-only, so
# there is no host left to run it on.
[[ -f "${REPO_ROOT}/cloudhost247-node/server.js" ]] \
  && fail "the retired cPanel Passenger bootstrap (server.js) is back" \
  || pass "cPanel Passenger bootstrap is gone (VPS-only)"
grep -q 'DISABLE_AUTO_BUILD' "${VPS_DIR}/systemd/cloudhost247-node.service" \
  && fail "node unit still carries the Passenger auto-build flag" \
  || pass "node unit carries no Passenger auto-build flag"
grep -q 'ExecStartPre=/usr/bin/test -f __APP_ROOT__/dist/src/server.js' "${VPS_DIR}/systemd/cloudhost247-node.service" \
  && pass "node unit fails fast if the build is missing (ExecStartPre guard)" \
  || fail "node unit has no ExecStartPre build guard"
grep -q 'dist/src/worker/main.js' "${VPS_DIR}/systemd/cloudhost247-worker.service" \
  && pass "worker unit runs the compiled worker" || fail "worker unit entrypoint wrong"
for unit in cloudhost247-node cloudhost247-worker; do
  grep -q '^Group=__APP_USER__' "${VPS_DIR}/systemd/${unit}.service" \
    && pass "${unit} declares a Group" || fail "${unit} does not declare Group= (useradd needs --user-group)"
done
# install-whmcs.sh must locate init.php in BOTH archive layouts. The old
# `[[ -d "${tmpdir}/whmcs"* ]]` guard never matched (-d does not glob), so the
# find never ran and the installer died on every real WHMCS ZIP.
grep -q 'nested_whmcs="$(find' "${VPS_DIR}/scripts/install-whmcs.sh" \
  && pass "install-whmcs.sh locates a nested whmcs-*/ archive" \
  || fail "install-whmcs.sh cannot locate a nested whmcs-*/ archive"
# Match the executable line only (leading `if `), not the explanatory comment.
grep -qE '^[[:space:]]*if \[\[ -d "\$\{tmpdir\}/whmcs"\* \]\]' "${VPS_DIR}/scripts/install-whmcs.sh" \
  && fail "install-whmcs.sh is back to the never-matching -d glob test" \
  || pass "install-whmcs.sh does not use the never-matching -d glob test"
grep -q 'useradd --system --user-group' "${VPS_DIR}/setup-ubuntu-24.04.sh" \
  && pass "setup creates a matching user group" || fail "setup uses useradd without --user-group"

echo
echo "[7] Every placeholder is documented and rendered by the setup script"
placeholders=$(grep -rhoE '__[A-Z_]+__' "${VPS_DIR}" --include='*.conf' --include='*.service' --include='*.cron' | sort -u)
for ph in ${placeholders}; do
  if grep -rq "${ph}" "${VPS_DIR}/setup-ubuntu-24.04.sh"; then
    pass "${ph} is rendered by setup-ubuntu-24.04.sh"
  elif grep -rq "${ph}" "${VPS_DIR}/scripts/"; then
    pass "${ph} is rendered by a scripts/ installer"
  else
    fail "${ph} appears in a template but nothing renders it"
  fi
done

echo
echo "[7b] Logrotate stanzas keep per-owner permissions"
LR="${VPS_DIR}/logrotate/cloudhost247"
if grep -q 'create 0640 www-data adm' "${LR}" && grep -q 'create 0640 root adm' "${LR}"; then
  pass "logrotate recreates logs with the right owner per stanza"
else
  fail "logrotate uses one owner for logs written by different users"
fi
for block in 'nginx/cloudhost247-\*\.log' 'php8\.2-fpm\*\.log' 'cloudhost247/\*\.log'; do
  grep -q "${block}" "${LR}" && pass "logrotate covers ${block}" || fail "logrotate missing ${block}"
done

echo
echo "[8] Backup/restore use Ubuntu-sane database authentication"
grep -q 'sudo -u postgres pg_dump' "${VPS_DIR}/scripts/backup.sh" \
  && pass "pg_dump runs as the postgres OS user (peer auth)" \
  || fail "pg_dump does not run as postgres (peer auth will fail)"
grep -q 'sudo -u postgres pg_restore' "${VPS_DIR}/scripts/restore.sh" \
  && pass "pg_restore runs as the postgres OS user" \
  || fail "pg_restore does not run as postgres"
grep -q -- '--confirm' "${VPS_DIR}/scripts/restore.sh" \
  && pass "restore is gated behind --confirm" || fail "restore has no dry-run gate"

echo
echo "[8b] TLS issuance uses the webroot plugin, not --nginx rewriting"
# Exclude this harness itself, which necessarily contains the forbidden string.
if grep -rq --exclude='smoke-test.sh' 'certbot --nginx' \
     "${VPS_DIR}" "${REPO_ROOT}/docs/VPS_DEPLOYMENT.md"; then
  fail "a doc/script still uses 'certbot --nginx' (it rewrites the hand-tuned vhosts)"
else
  pass "no 'certbot --nginx' anywhere"
fi
if grep -Fq 'location ^~ /.well-known/acme-challenge/' "${VPS_DIR}/nginx/cloudhost247-whmcs.conf" \
   && grep -Fq 'location ^~ /.well-known/acme-challenge/' "${VPS_DIR}/nginx/cloudhost247-node.conf"; then
  pass "both vhosts serve the ACME challenge over plain HTTP"
else
  fail "an HTTP vhost would 301 the ACME challenge (issuance fails)"
fi
grep -q 'certbot certonly --webroot -w /var/www/letsencrypt' "${VPS_DIR}/README.md" \
  && pass "runbook documents the webroot invocation" || fail "runbook lacks the webroot invocation"

echo
echo "[9] CI workflow validates this stack"
if [[ -f "${REPO_ROOT}/.github/workflows/vps-stack.yml" ]]; then
  pass "vps-stack.yml workflow present"
  grep -q 'smoke-test.sh' "${REPO_ROOT}/.github/workflows/vps-stack.yml" \
    && pass "workflow runs this smoke test" || fail "workflow does not run smoke-test.sh"
  grep -q 'nginx -t' "${REPO_ROOT}/.github/workflows/vps-stack.yml" \
    && pass "workflow runs a real nginx -t" || fail "workflow does not run nginx -t"
else
  fail ".github/workflows/vps-stack.yml missing"
fi

echo
echo "[10] Documentation links resolve"
for doc in docs/VPS_DEPLOYMENT.md infrastructure/vps/README.md README.md; do
  [[ -f "${REPO_ROOT}/${doc}" ]] && pass "${doc} exists" || fail "${doc} missing"
done
if grep -q 'docs/VPS_DEPLOYMENT.md' "${REPO_ROOT}/README.md"; then
  pass "root README points at the VPS runbook"
else
  fail "root README does not reference docs/VPS_DEPLOYMENT.md"
fi

echo
echo "[11] The cPanel/Passenger deployment path stays retired"
# The deployment target is VPS-only. These artefacts must not come back: their
# presence is how a cPanel deploy quietly becomes possible again.
for gone in \
  docs/CPANEL_DEPLOYMENT.md \
  cloudhost247-node/docs/CPANEL_DEPLOYMENT.md \
  cloudhost247-node/scripts/package-cpanel.sh \
  cloudhost247-node/server.js \
  infrastructure/litespeed/webroot-hardening.htaccess; do
  [[ -e "${REPO_ROOT}/${gone}" ]] \
    && fail "retired cPanel artefact is back: ${gone}" \
    || pass "retired: ${gone}"
done
# `npm start` must run the compiled app, not a Passenger bootstrap.
if grep -q '"start": "node dist/src/server.js"' "${REPO_ROOT}/cloudhost247-node/package.json"; then
  pass "npm start runs the compiled app"
else
  fail "npm start does not run dist/src/server.js"
fi
grep -q 'Passenger' "${REPO_ROOT}/cloudhost247-node/package.json" \
  && fail "package.json still describes a Passenger deployment" \
  || pass "package.json describes no Passenger deployment"
# The product still SELLS cPanel hosting — that is not infrastructure and must stay.
[[ -d "${REPO_ROOT}/cloudhost247-node/src/control-panels/adapters" ]] \
  && pass "cPanel hosting remains a sellable product (control-panel adapters intact)" \
  || fail "control-panel adapters were deleted — that was product code, not deployment"

echo
echo "----------------------------------------"
printf 'passed: %d   failed: %d\n' "${PASS}" "${FAIL}"
if [[ "${FAIL}" -gt 0 ]]; then
  echo "SMOKE TEST FAILED"
  exit 1
fi
echo "SMOKE TEST PASSED"
