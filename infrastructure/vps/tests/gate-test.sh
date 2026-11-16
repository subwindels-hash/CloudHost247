#!/usr/bin/env bash
# CloudHost247 — offline proof that the provisioning gate can FAIL.
#
# A verification step that cannot fail is worse than none: it produces a green
# run on a host where WHMCS cannot execute. This extracts the "Final gate" block
# from setup-ubuntu-24.04.sh, runs it against stub `php`/`node` binaries with
# known defects, and asserts each defect is rejected.
#
# No root, no network, no VPS. Run: bash infrastructure/vps/tests/gate-test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SETUP="${REPO_ROOT}/infrastructure/vps/setup-ubuntu-24.04.sh"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Extract the gate (everything between the gate banner and the success banner).
awk '/^# Final gate: re-check/{f=1} f && /^log "Provisioning complete\."/{exit} f' \
  "${SETUP}" | grep -v '^log "Final verification"' > "${WORK}/gate.sh"

echo "Provisioning gate test"
echo

if [[ ! -s "${WORK}/gate.sh" ]]; then
  echo "  FAIL  could not extract the final gate from setup-ubuntu-24.04.sh"
  exit 1
fi
if grep -q 'PHP_VERSION_ACTUAL' "${WORK}/gate.sh"; then
  pass "gate parses the PHP version instead of trusting an exit code"
else
  fail "gate does not check the PHP version string"
fi

# run_case <label> <modules> <php-version> <expect: accept|reject>
run_case() {
  local label="$1" modules="$2" version="$3" expect="$4"
  local dir="${WORK}/case-$RANDOM$RANDOM"
  mkdir -p "${dir}"
  # shellcheck disable=SC2016
  cat > "${dir}/php" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "-m" ]; then printf '%s\n' ${modules}; exit 0; fi
if [ "\$1" = "-r" ]; then echo "${version}"; exit 0; fi
exit 0
EOF
  cat > "${dir}/node" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo v22.12.0; exit 0; fi
exit 0
EOF
  chmod +x "${dir}/php" "${dir}/node"

  local out
  out="$(PATH="${dir}:${PATH}" bash -c "die(){ echo \"REJECT: \$*\" >&2; exit 1; }
$(cat "${WORK}/gate.sh")
echo ACCEPTED" 2>&1)"

  local got
  if grep -q '^ACCEPTED' <<<"${out}"; then got="accept"; else got="reject"; fi

  if [[ "${got}" == "${expect}" ]]; then
    pass "${label} -> ${got}"
  else
    fail "${label} -> ${got} (expected ${expect})"
    printf '%s\n' "${out}" | grep -E 'REJECT|ACCEPTED' | head -2 | sed 's/^/        /'
  fi
}

GOOD_MODS="curl json openssl PDO pdo_mysql mbstring dom fileinfo filter gd imap soap xml zip intl bcmath ioncube"

echo
echo "[a correctly provisioned host is accepted]"
run_case "PHP 8.2 + ionCube + all extensions" "${GOOD_MODS}" "8.2.29" accept

echo
echo "[each defect must be rejected, or provisioning lies about being ready]"
run_case "ionCube Loader missing" "${GOOD_MODS/ioncube/}" "8.2.29" reject
run_case "PHP 8.3 instead of 8.2"  "${GOOD_MODS}" "8.3.6" reject
run_case "pdo_mysql missing"       "${GOOD_MODS/pdo_mysql/}" "8.2.29" reject
run_case "zip missing"             "${GOOD_MODS/ zip/}" "8.2.29" reject
run_case "intl missing"            "${GOOD_MODS/ intl/}" "8.2.29" reject
run_case "gd missing"              "${GOOD_MODS/ gd/}" "8.2.29" reject

echo
echo "----------------------------------------"
printf 'passed: %d   failed: %d\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]] || { echo "GATE TEST FAILED"; exit 1; }
echo "GATE TEST PASSED"
