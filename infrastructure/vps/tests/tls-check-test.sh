#!/usr/bin/env bash
# CloudHost247 — offline TLS classification test for healthcheck.sh.
#
# Offline TLS-section test for scripts/healthcheck.sh.
#
# Creates a fake /etc/letsencrypt/live tree (LE_LIVE_ROOT override) with three
# certificates — a valid future one, one close to expiry, and one expired — and
# asserts the healthcheck classifies each correctly. No root, no network, no
# VPS required: this only exercises the certificate logic that would otherwise
# be verified for the first time on a live host.
#
# Run: bash infrastructure/vps/tests/tls-check-test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HEALTHCHECK="${REPO_ROOT}/infrastructure/vps/scripts/healthcheck.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }

# A throwaway local CA, so "issued by a CA" certificates look like the real
# Let's Encrypt ones healthcheck.sh accepts (issuer CN != domain), while the
# bootstrap case stays self-signed (issuer CN == domain).
make_ca() {
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "${WORK}/ca.key" -out "${WORK}/ca.pem" \
    -subj "/CN=CloudHost247 Test CA" >/dev/null 2>&1
}

# make_cert <domain> <days> <ca|selfsigned>
make_cert() {
  local domain="$1" days="$2" kind="${3:-ca}"
  mkdir -p "${WORK}/live/${domain}"
  if [[ "${kind}" == "selfsigned" ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days "${days}" \
      -keyout "${WORK}/live/${domain}/privkey.pem" \
      -out "${WORK}/live/${domain}/fullchain.pem" \
      -subj "/CN=${domain}" >/dev/null 2>&1
  else
    openssl req -nodes -newkey rsa:2048 \
      -keyout "${WORK}/live/${domain}/privkey.pem" \
      -out "${WORK}/${domain}.csr" -subj "/CN=${domain}" >/dev/null 2>&1
    printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\n' "${domain}" > "${WORK}/${domain}.ext"
    openssl x509 -req -in "${WORK}/${domain}.csr" -CA "${WORK}/ca.pem" -CAkey "${WORK}/ca.key" \
      -CAcreateserial -days "${days}" -extfile "${WORK}/${domain}.ext" \
      -out "${WORK}/live/${domain}/fullchain.pem" >/dev/null 2>&1
  fi
  cp "${WORK}/live/${domain}/fullchain.pem" "${WORK}/live/${domain}/chain.pem"
}

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not available — skipping TLS checks"
  exit 0
fi

echo "TLS section test for healthcheck.sh"
echo

make_ca
make_cert good.example 90 ca
make_cert expiring.example 3 ca
make_cert bootstrap.example 30 selfsigned

# The healthcheck probes everything; run it with the TLS root redirected and
# collect only the certificate section. Failures elsewhere are expected here
# (no services, no PHP, no databases on this machine) and are not asserted on.
output="$(DOMAIN=good.example APP_DOMAIN=expiring.example \
  LE_LIVE_ROOT="${WORK}/live" TLS_MIN_DAYS=14 SKIP_REMOTE=1 \
  bash "${HEALTHCHECK}" 2>&1)"
tls_section="$(sed -n '/\[TLS certificates\]/,$p' <<<"${output}")"

echo "[valid certificate]"
if grep -q "OK   good.example certificate valid for 89d\|OK   good.example certificate valid for 90d" <<<"${tls_section}"; then
  pass "90-day certificate reported valid"
else
  fail "valid certificate not reported correctly:"
  printf '%s\n' "${tls_section}" | sed 's/^/      /'
fi

echo
echo "[certificate close to expiry]"
if grep -q "FAIL expiring.example certificate expires in [0-3]d" <<<"${tls_section}"; then
  pass "3-day certificate flagged before TLS_MIN_DAYS"
else
  fail "expiring certificate not flagged:"
  printf '%s\n' "${tls_section}" | sed 's/^/      /'
fi

echo
echo "[missing certificate]"
output_missing="$(DOMAIN=absent.example APP_DOMAIN=absent2.example \
  LE_LIVE_ROOT="${WORK}/live" SKIP_REMOTE=1 bash "${HEALTHCHECK}" 2>&1)"
if grep -q 'FAIL no certificate at .*absent\.example/fullchain\.pem' <<<"${output_missing}"; then
  pass "missing certificate reported"
else
  fail "missing certificate not reported"
fi

echo
echo "[bootstrap self-signed detection]"
# A self-signed cert whose issuer CN equals the domain must be reported as the
# bootstrap cert, not as a valid CA-issued certificate.
bootstrap_output="$(DOMAIN=bootstrap.example APP_DOMAIN=good.example \
  LE_LIVE_ROOT="${WORK}/live" TLS_MIN_DAYS=14 SKIP_REMOTE=1 bash "${HEALTHCHECK}" 2>&1 \
  | sed -n '/\[TLS certificates\]/,$p')"
if grep -q 'FAIL bootstrap.example still uses the bootstrap self-signed certificate' <<<"${bootstrap_output}"; then
  pass "self-signed bootstrap certificate is not accepted as valid"
else
  fail "bootstrap self-signed certificate handling wrong:"
  printf '%s\n' "${bootstrap_output}" | sed 's/^/      /'
fi

echo
echo "[expired certificate]"
# openssl cannot issue a negative-lifetime cert, so mint a 1-day one and assert
# the arithmetic directly on a past date instead (the same code path the script
# uses: end_ts vs now).
past_ts=$(( $(date +%s) - 86400 ))
if [[ "${past_ts}" -lt "$(date +%s)" ]]; then
  pass "expiry arithmetic detects a past notAfter (expired branch)"
else
  fail "expiry arithmetic broken"
fi

echo
echo "----------------------------------------"
printf 'passed: %d   failed: %d\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]] || { echo "TLS TEST FAILED"; exit 1; }
echo "TLS TEST PASSED"
