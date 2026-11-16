#!/usr/bin/env bash
# CloudHost247 — VPS healthcheck (WHMCS + Node + PHP-FPM + databases + TLS).
#
# Probes:
#   - systemd: cloudhost247-node, cloudhost247-worker, php8.2-fpm, nginx, mysql, postgresql
#   - Node:    http://127.0.0.1:3000/health + /ready
#   - WHMCS:   https://<DOMAIN>/ (HTTP 200/302; 503 usually means PHP-FPM is down)
#   - PHP:     version 8.2, ionCube loaded, pdo_mysql/curl present
#   - DBs:     mysqladmin ping, pg_isready
#   - TLS:     certificates present and valid for > TLS_MIN_DAYS days
#
# Exit code 0 = every check passed, 1 = at least one failed (safe for cron/CI).
#
# Usage:
#   bash infrastructure/vps/scripts/healthcheck.sh
#   bash infrastructure/vps/scripts/healthcheck.sh --quiet   # only failures
#
# Environment overrides:
#   DOMAIN=cloudhost247.com APP_DOMAIN=app.cloudhost247.com
#   NODE_HEALTH_URL=... NODE_READY_URL=... TLS_MIN_DAYS=14
#   SKIP_REMOTE=1   (skip the outbound HTTPS probe — useful in CI / pre-DNS)
set -uo pipefail

DOMAIN="${DOMAIN:-cloudhost247.com}"
APP_DOMAIN="${APP_DOMAIN:-app.cloudhost247.com}"
NODE_HEALTH_URL="${NODE_HEALTH_URL:-http://127.0.0.1:3000/health}"
NODE_READY_URL="${NODE_READY_URL:-http://127.0.0.1:3000/ready}"
TLS_MIN_DAYS="${TLS_MIN_DAYS:-14}"
# Overridable so the TLS section can be exercised off-server (see tests/).
LE_LIVE_ROOT="${LE_LIVE_ROOT:-/etc/letsencrypt/live}"
SKIP_REMOTE="${SKIP_REMOTE:-0}"
QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

FAIL=0
ok()   { [[ "${QUIET}" -eq 1 ]] || printf '  OK   %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*"; FAIL=$((FAIL + 1)); }
note() { [[ "${QUIET}" -eq 1 ]] || printf '  --   %s\n' "$*"; }
head_() { [[ "${QUIET}" -eq 1 ]] || { echo; echo "[$1]"; }; }

# Returns the HTTP status code for a URL, or 000 on any failure.
# (curl prints its -w string even when it exits non-zero, so the output is
# normalised rather than appended to with `|| echo 000`, which produced "000000".)
http_code() {
  local out
  out="$(curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "$1" 2>/dev/null)" || true
  [[ "${out}" =~ ^[0-9]{3}$ ]] || out=000
  printf '%s' "${out}"
}

[[ "${QUIET}" -eq 1 ]] || { echo "CloudHost247 VPS healthcheck — $(date -Is)"; }

head_ systemd
for svc in cloudhost247-node cloudhost247-worker php8.2-fpm nginx mysql postgresql; do
  if systemctl is-active --quiet "${svc}" 2>/dev/null; then
    ok "${svc} active"
  else
    bad "${svc} NOT active"
  fi
done

head_ "Node platform"
code="$(http_code "${NODE_HEALTH_URL}")"
if [[ "${code}" == "200" ]]; then ok "GET ${NODE_HEALTH_URL} -> 200"
else bad "GET ${NODE_HEALTH_URL} -> ${code} (expected 200; check: journalctl -u cloudhost247-node -n 50)"; fi

code="$(http_code "${NODE_READY_URL}")"
if [[ "${code}" == "200" ]]; then ok "GET ${NODE_READY_URL} -> 200"
else bad "GET ${NODE_READY_URL} -> ${code} (expected 200; 503 usually means DATABASE_URL/database is not ready)"; fi

head_ WHMCS
# The overlay must never have removed WHMCS core (see install-whmcs.sh): the
# order forms and the 5-minute cron both depend on stock core files.
WHMCS_ROOT_CHECK="${WHMCS_ROOT:-/var/www/whmcs}"
if [[ -d "${WHMCS_ROOT_CHECK}" ]]; then
  if [[ -f "${WHMCS_ROOT_CHECK}/crons/cron.php" ]]; then
    ok "WHMCS core crons/cron.php present"
  else
    bad "WHMCS core crons/cron.php MISSING (the 5-minute cron will do nothing)"
  fi
  if [[ -d "${WHMCS_ROOT_CHECK}/templates/orderforms/standard_cart" ]]; then
    ok "WHMCS core standard_cart order form present"
  else
    bad "WHMCS core standard_cart order form MISSING (ovh_cart falls back to it)"
  fi
  if [[ -d "${WHMCS_ROOT_CHECK}/install" ]]; then
    bad "WHMCS install/ directory still present — delete it (rm -rf ${WHMCS_ROOT_CHECK}/install)"
  else
    ok "WHMCS install/ directory removed"
  fi
else
  note "WHMCS root ${WHMCS_ROOT_CHECK} not present on this host"
fi
if [[ "${SKIP_REMOTE}" == "1" ]]; then
  note "skipped (SKIP_REMOTE=1)"
else
  code="$(http_code "https://${DOMAIN}/" 15)"
  case "${code}" in
    200|302) ok "GET https://${DOMAIN}/ -> ${code}" ;;
    000)     bad "GET https://${DOMAIN}/ -> no response (DNS not pointed at this VPS, or Nginx/TLS down)" ;;
    502|503|504) bad "GET https://${DOMAIN}/ -> ${code} (PHP-FPM upstream down: systemctl status php8.2-fpm)" ;;
    *)       bad "GET https://${DOMAIN}/ -> ${code} (expected 200/302)" ;;
  esac
fi

head_ PHP
if command -v php >/dev/null 2>&1; then
  php_version="$(php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;' 2>/dev/null || echo unknown)"
  if [[ "${php_version}" == "8.2" ]]; then ok "PHP ${php_version}"
  else bad "PHP ${php_version} (WHMCS 8.x requires 8.2 on this stack; check update-alternatives)"; fi

  modules="$(php -m 2>/dev/null || true)"
  for ext in ioncube pdo_mysql curl mbstring gd soap zip intl; do
    if grep -qi "^${ext}\$" <<<"${modules}"; then ok "PHP ext ${ext} loaded"
    else bad "PHP ext ${ext} MISSING"; fi
  done
else
  bad "php binary not found"
fi

head_ Databases
if mysqladmin ping --silent >/dev/null 2>&1; then ok "MySQL ping OK"; else bad "MySQL ping FAILED"; fi
if command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  ok "PostgreSQL ready"
else
  bad "PostgreSQL NOT ready"
fi

head_ "TLS certificates"
if command -v openssl >/dev/null 2>&1; then
  for d in "${DOMAIN}" "${APP_DOMAIN}"; do
    cert="${LE_LIVE_ROOT}/${d}/fullchain.pem"
    if [[ ! -s "${cert}" ]]; then
      bad "no certificate at ${cert}"
      continue
    fi
    # Compare notAfter against now; report remaining days.
    end_epoch="$(openssl x509 -in "${cert}" -noout -enddate 2>/dev/null | cut -d= -f2)"
    if [[ -z "${end_epoch}" ]]; then
      bad "cannot read expiry from ${cert}"
      continue
    fi
    end_ts="$(date -d "${end_epoch}" +%s 2>/dev/null || echo 0)"
    days=$(( (end_ts - $(date +%s)) / 86400 ))
    issuer="$(openssl x509 -in "${cert}" -noout -issuer 2>/dev/null | sed 's/.*CN *= *//')"
    if [[ "${days}" -lt 0 ]]; then
      bad "${d} certificate EXPIRED (${issuer})"
    elif [[ "${days}" -lt "${TLS_MIN_DAYS}" ]]; then
      bad "${d} certificate expires in ${days}d (< ${TLS_MIN_DAYS}d) — check certbot renew"
    elif [[ "${issuer}" == *"self-signed"* || "${issuer}" == "${d}" ]]; then
      bad "${d} still uses the bootstrap self-signed certificate — run: certbot certonly --webroot -w /var/www/letsencrypt -d ${d} && systemctl reload nginx"
    else
      ok "${d} certificate valid for ${days}d (${issuer})"
    fi
  done
else
  note "openssl not installed — cannot check certificates"
fi

echo
if [[ "${FAIL}" -eq 0 ]]; then
  echo "Healthcheck: ALL CHECKS PASSED"
  exit 0
else
  echo "Healthcheck: ${FAIL} CHECK(S) FAILED"
  exit 1
fi
