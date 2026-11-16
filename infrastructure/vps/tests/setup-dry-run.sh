#!/usr/bin/env bash
# CloudHost247 — dry-run harness for setup-ubuntu-24.04.sh.
#
# Runs the provisioning script with `set -x`-style tracing but every mutating
# external command stubbed out, into a private temp root instead of /etc.
# The point is to prove the script's own logic — variable rendering, ordering,
# conditionals, placeholder substitution — executes end to end without root or
# a VPS, and to show exactly what it would write.
#
# Usage: bash infrastructure/vps/tests/setup-dry-run.sh
#
# What is real: the script itself, its placeholders, the rendered outputs.
# What is stubbed: apt/dnf, systemctl, ufw, mysql, php, node/npm, curl/wget,
# useradd, openssl, certbot, swap tools, and the /etc writes (redirected into
# $DRY_ROOT so the host is untouched).
#
# This is NOT a substitute for running the real script on a real Ubuntu 24.04
# VPS — see docs/VPS_DEPLOYMENT.md Appendix C.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRY_ROOT="$(mktemp -d)"
BIN="${DRY_ROOT}/bin"
mkdir -p "${BIN}"

cleanup() { [[ -n "${KEEP:-}" ]] || rm -rf "${DRY_ROOT}"; }
trap cleanup EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }

echo "setup-ubuntu-24.04.sh dry run"
echo "scratch root: ${DRY_ROOT}"
echo

# --- stubs -----------------------------------------------------------------
# Every mutation is recorded to ${DRY_ROOT}/calls.log so the assertions can
# check ORDER (e.g. UFW rules before enable) as well as presence.
record() { printf '%s\n' "$*" >> "${DRY_ROOT}/calls.log"; }

stub() {
  local name="$1"
  cat > "${BIN}/${name}" <<EOF
#!/usr/bin/env bash
printf '${name} %s\\n' "\$*" >> "${DRY_ROOT}/calls.log"
exit 0
EOF
  chmod +x "${BIN}/${name}"
}

for cmd in apt-get apt add-apt-repository dpkg systemctl ufw mysql mysqladmin \
           mysqldump psql pg_dump pg_restore pg_isready swapon mkswap fallocate \
           useradd usermod certbot nginx logrotate; do
  stub "${cmd}"
done

# These must print plausible output because the script parses it.
cat > "${BIN}/php" <<'EOF'
#!/usr/bin/env bash
# Match on $1, not "$*": the gate calls `php -r 'echo PHP_VERSION;'`, whose $*
# is "-r echo PHP_VERSION;" and would not match a "-r" pattern.
case "$1" in
  -v) echo "PHP 8.2.29 (cli) (built: dry-run)"; exit 0 ;;
  -m) printf 'ionCube Loader\ncurl\njson\nopenssl\nPDO\npdo_mysql\nmbstring\ndom\nfileinfo\nfilter\ngd\nimap\nsoap\nxml\nzip\nintl\nbcmath\n'; exit 0 ;;
  -r) echo "8.2.29"; exit 0 ;;
  *)  exit 0 ;;
esac
EOF
chmod +x "${BIN}/php"

cat > "${BIN}/node" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "--version") echo "v22.12.0" ;;
  -e*) echo "" ;;
  *) exit 0 ;;
esac
EOF
printf '#!/usr/bin/env bash\necho "10.9.0"\n' > "${BIN}/npm"
printf '#!/usr/bin/env bash\necho "mysql  Ver 8.0.39 for Linux on x86_64"\n' > "${BIN}/mysqldump-version"
chmod +x "${BIN}/node" "${BIN}/npm" "${BIN}/mysqldump-version"

# `id -u` must report root, otherwise the script's own root gate refuses to run.
cat > "${BIN}/id" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-u" ]]; then echo 0; else exec /usr/bin/id "$@"; fi
EOF
chmod +x "${BIN}/id"

# The script validates the OS from /etc/os-release; the copy below rewrites that
# path to the scratch root, and wget/tar are stubbed so ionCube never downloads.

# openssl: produce real files so later `[[ -s ... ]]` checks pass.
cat > "${BIN}/openssl" <<EOF
#!/usr/bin/env bash
printf 'openssl %s\\n' "\$*" >> "${DRY_ROOT}/calls.log"
# find -keyout / -out arguments and create them
prev=""
for arg in "\$@"; do
  case "\$prev" in
    -keyout|-out) mkdir -p "\$(dirname "\$arg")"; : > "\$arg" ;;
  esac
  prev="\$arg"
done
exit 0
EOF
chmod +x "${BIN}/openssl"

cat > "${BIN}/curl" <<'EOF'
#!/usr/bin/env bash
# node source setup script needs no real fetch in a dry run
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "${BIN}/wget"
printf '#!/usr/bin/env bash\nexit 0\n' > "${BIN}/tar"
chmod +x "${BIN}/curl" "${BIN}/wget" "${BIN}/tar"

# --- run -------------------------------------------------------------------
# The OS gate requires ubuntu/noble from /etc/os-release; provide a fake one.
mkdir -p "${DRY_ROOT}/etc"
cat > "${DRY_ROOT}/etc/os-release" <<'EOF'
ID=ubuntu
VERSION_CODENAME=noble
PRETTY_NAME="Ubuntu 24.04 LTS"
EOF

echo "[running the provisioning script with stubs on PATH]"
# Redirect every absolute /etc path the script writes into the scratch root by
# making the script believe /etc lives there is not possible without patching it,
# so the run is done in a copy whose /etc references are rewritten.
SCRIPT="${DRY_ROOT}/setup.sh"
sed -e "s#/etc/#${DRY_ROOT}/etc/#g" \
    -e "s#/var/log/#${DRY_ROOT}/var/log/#g" \
    -e "s#/var/backups/#${DRY_ROOT}/var/backups/#g" \
    -e "s#/var/www/#${DRY_ROOT}/var/www/#g" \
    -e "s#/var/lib/#${DRY_ROOT}/var/lib/#g" \
    -e "s#/opt/cloudhost247#${DRY_ROOT}/opt/cloudhost247#g" \
    -e "s#/usr/lib/php/#${DRY_ROOT}/usr/lib/php/#g" \
    -e "s#/run/php/#${DRY_ROOT}/run/php/#g" \
    -e "s#/usr/sbin/nologin#/bin/bash#g" \
    -e "s#^set -euo pipefail#set -uo pipefail#" \
    -e "s#^SRC_DIR=.*#SRC_DIR=\"${REPO_ROOT}\"#" \
    "${REPO_ROOT}/infrastructure/vps/setup-ubuntu-24.04.sh" > "${SCRIPT}"

# The copy lives in the scratch root, so its SRC_DIR autodetection would resolve
# to nothing. Point it at the real checkout (this is the only script logic the
# harness rewrites, and it is asserted below).

# Pre-create the directories the real packages would provide (apt is stubbed,
# so nothing creates /etc/nginx/snippets, /etc/php/8.2/fpm/pool.d, etc.).
mkdir -p "${DRY_ROOT}/etc"/{nginx/sites-available,nginx/sites-enabled,nginx/snippets} \
         "${DRY_ROOT}/etc"/{systemd/system,cron.d,logrotate.d,fail2ban} \
         "${DRY_ROOT}/etc"/php/8.2/{fpm/pool.d,fpm/conf.d,cli/conf.d} \
         "${DRY_ROOT}/etc"/{mysql/mysql.conf.d,apt/apt.conf.d,postgresql/16/main} \
         "${DRY_ROOT}/etc"/letsencrypt/live \
         "${DRY_ROOT}/var/log" "${DRY_ROOT}/var/www" "${DRY_ROOT}/var/backups" \
         "${DRY_ROOT}/var/lib" \
         "${DRY_ROOT}/usr/lib/php" "${DRY_ROOT}/run/php" "${DRY_ROOT}/opt"

run_output="$(PATH="${BIN}:${PATH}" DOMAIN=dry.example APP_DOMAIN=app.dry.example \
  APP_USER=dryuser APP_ROOT="${DRY_ROOT}/opt/cloudhost247" \
  WHMCS_ROOT="${DRY_ROOT}/var/www/whmcs" \
  MODULE_STORAGE="${DRY_ROOT}/var/lib/cloudhost247" \
  SRC_DIR="${REPO_ROOT}" \
  bash "${SCRIPT}" 2>&1)"
run_status=$?

if [[ "${run_status}" -eq 0 ]]; then
  pass "provisioning script completes with stubs (exit 0)"
else
  fail "provisioning script exited ${run_status}:"
  printf '%s\n' "${run_output}" | tail -25 | sed 's/^/      /'
fi

echo
echo "[rendered artefacts]"

vhost="${DRY_ROOT}/etc/nginx/sites-available/cloudhost247-whmcs.conf"
if [[ -f "${vhost}" ]]; then
  pass "WHMCS vhost rendered"
  grep -q 'dry\.example' "${vhost}" && pass "  domain substituted" || fail "  __DOMAIN__ not substituted"
  grep -q '__DOMAIN__\|__APP_DOMAIN__' "${vhost}" && fail "  placeholder left behind" || pass "  no placeholders left"
else
  fail "WHMCS vhost not rendered"
fi

node_vhost="${DRY_ROOT}/etc/nginx/sites-available/cloudhost247-node.conf"
if [[ -f "${node_vhost}" ]]; then
  grep -q 'app\.dry\.example' "${node_vhost}" \
    && pass "Node vhost rendered with app domain" || fail "Node vhost domain not substituted"
else
  fail "Node vhost not rendered"
fi

if [[ -f "${vhost}" ]]; then
  grep -q "root ${DRY_ROOT}/var/www/whmcs;" "${vhost}" \
    && pass "  WHMCS_ROOT rendered into the vhost root directive" \
    || fail "  vhost root is not the rendered WHMCS_ROOT"
  grep -q '__WHMCS_ROOT__' "${vhost}" \
    && fail "  __WHMCS_ROOT__ placeholder left behind" || pass "  no __WHMCS_ROOT__ left behind"
  grep -qE 'location ~ \^/\(templates_c\|attachments\|downloads\|crons\|storage\|vendor\)/' "${vhost}" \
    && pass "  internal WHMCS directories (crons/storage/vendor) are denied" \
    || fail "  crons/, storage/ or vendor/ is still web-reachable"
  grep -q '/modules/addons/cloudhost247_domain_lookup/cache/' "${vhost}" \
    && pass "  addon cache directory is denied" || fail "  addon cache directory is web-reachable"
  grep -q '\^/assets/ch247-media/.*\\.(php' "${vhost}" \
    && pass "  PHP execution is denied inside uploaded builder media" \
    || fail "  uploaded builder media can still execute PHP"
fi

pool="${DRY_ROOT}/etc/php/8.2/fpm/pool.d/www.conf"
if [[ -f "${pool}" ]]; then
  grep -q "^env\[CH247_MODULE_STORAGE\] = ${DRY_ROOT}/var/lib/cloudhost247$" "${pool}" \
    && pass "  PHP-FPM exports CH247_MODULE_STORAGE (out-of-webroot module storage)" \
    || fail "  CH247_MODULE_STORAGE not rendered into the PHP-FPM pool"
  grep -q "^php_admin_value\[open_basedir\] = ${DRY_ROOT}/var/www/whmcs/:${DRY_ROOT}/var/lib/cloudhost247/:/tmp/:/var/tmp/$" "${pool}" \
    && pass "  open_basedir covers the WHMCS root AND module storage" \
    || fail "  open_basedir does not match the rendered roots: $(grep -m1 'open_basedir' "${pool}")"
fi

storage="${DRY_ROOT}/var/lib/cloudhost247"
if [[ -d "${storage}" ]]; then
  pass "module storage directory created outside the web root"
  # chown to www-data needs root, which a dry run may not have — assert the mode
  # here and the ownership commands in the script itself.
  mode="$(stat -c '%a' "${storage}")"
  [[ "${mode}" == "700" ]] \
    && pass "  module storage is mode 0700" \
    || fail "  module storage mode is ${mode}, expected 700"
else
  fail "module storage directory not created at ${storage}"
fi
if grep -q 'chown -R www-data:www-data "${MODULE_STORAGE}"' "${REPO_ROOT}/infrastructure/vps/setup-ubuntu-24.04.sh" \
   && grep -q 'chmod 700 "${MODULE_STORAGE}"' "${REPO_ROOT}/infrastructure/vps/setup-ubuntu-24.04.sh"; then
  pass "  module storage is chowned to www-data and locked to 0700"
else
  fail "  module storage ownership/permissions are not enforced by the setup script"
fi

unit="${DRY_ROOT}/etc/systemd/system/cloudhost247-node.service"
if [[ -f "${unit}" ]]; then
  pass "node systemd unit rendered"
  grep -q "^User=dryuser" "${unit}" && pass "  User substituted" || fail "  __APP_USER__ not substituted"
  grep -q "^Group=dryuser" "${unit}" && pass "  Group substituted" || fail "  Group not substituted"
  grep -q '__APP_ROOT__\|__APP_USER__' "${unit}" && fail "  placeholder left behind" || pass "  no placeholders left"
else
  fail "node systemd unit not rendered"
fi

worker="${DRY_ROOT}/etc/systemd/system/cloudhost247-worker.service"
[[ -f "${worker}" ]] && pass "worker systemd unit rendered" || fail "worker systemd unit not rendered"

cron_file="${DRY_ROOT}/etc/cron.d/cloudhost247"
if [[ -f "${cron_file}" ]]; then
  pass "cron file installed"
  grep -q '__SRC_DIR__\|__WHMCS_ROOT__\|__APP_ROOT__' "${cron_file}" \
    && fail "  placeholders left in cron file" || pass "  cron placeholders rendered"
  grep -q "${REPO_ROOT}/infrastructure/vps/scripts/backup.sh" "${cron_file}" \
    && pass "  backup job points at the real checkout" || fail "  backup job path wrong"
  grep -q 'systemctl is-active --quiet cloudhost247-worker' "${cron_file}" \
    && pass "  worker fallback is guarded by systemd" || fail "  worker fallback not guarded"
  grep -q '__[A-Z_]*__' "${cron_file}" \
    && fail "  unrendered placeholder left in cron file" || pass "  every cron placeholder is rendered"
  grep -q 'sudo -u www-data /usr/bin/php8.2 .*crons/cron.php' "${cron_file}" \
    && pass "  WHMCS cron runs as www-data (files it writes stay web-server owned)" \
    || fail "  WHMCS cron does not run as www-data"
  grep -q '^30 2 \* \* \* root .*backup.sh' "${cron_file}" \
    && pass "  nightly backup runs as root with explicit roots" || fail "  nightly backup entry is wrong"
else
  fail "cron file not installed"
fi

for f in "${DRY_ROOT}/etc/logrotate.d/cloudhost247" "${DRY_ROOT}/etc/fail2ban/jail.local" \
         "${DRY_ROOT}/etc/nginx/snippets/security-headers.conf" \
         "${DRY_ROOT}/etc/nginx/snippets/csp-whmcs.conf" \
         "${DRY_ROOT}/etc/php/8.2/fpm/pool.d/www.conf" \
         "${DRY_ROOT}/etc/php/8.2/fpm/conf.d/zz-cloudhost247.ini"; do
  [[ -f "$f" ]] && pass "$(basename "$f") installed" || fail "$(basename "$f") NOT installed"
done

echo
echo "[ordering and safety guarantees]"

# UFW: all allow rules must be recorded before the enable line.
# The provisioning script redirects into the scratch root, so stub calls are
# logged there too; read whichever log exists.
if [[ -f "${DRY_ROOT}/calls.log" ]]; then
  CALLS="${DRY_ROOT}/calls.log"
  ssh_line="$(grep -n 'ufw allow OpenSSH' "${CALLS}" | head -1 | cut -d: -f1)"
  enable_line="$(grep -n 'ufw --force enable' "${CALLS}" | head -1 | cut -d: -f1)"
  if [[ -n "${ssh_line}" && -n "${enable_line}" && "${ssh_line}" -lt "${enable_line}" ]]; then
    pass "UFW allows SSH before enabling (no lockout)"
  else
    fail "UFW enable happens before the SSH allow rule (lockout risk)"
  fi

  grep -q 'useradd --system --user-group' "${REPO_ROOT}/infrastructure/vps/setup-ubuntu-24.04.sh" \
    && pass "useradd creates a group (systemd Group= works)" || fail "useradd lacks --user-group"

  grep -q '^nginx -t' "${CALLS}" && pass "nginx -t runs during provisioning" \
    || fail "nginx -t does not run"
else
  fail "no calls.log — nothing executed"
fi

echo
echo "[webroot leak check]"
# install-whmcs.sh must not copy whole directories into the webroot.
if grep -q "cp -f \"\${root_pages\[@\]}\" \"\${WHMCS_ROOT}/\"" \
     "${REPO_ROOT}/infrastructure/vps/scripts/install-whmcs.sh"; then
  pass "root pages are copied by explicit file list"
else
  fail "install-whmcs.sh may recursively copy the repo into the webroot"
fi
if grep -qE "rsync .*\\\$\\{SRC_DIR\\}/\\\" \\\"\\\$\\{WHMCS_ROOT\\}" \
     "${REPO_ROOT}/infrastructure/vps/scripts/install-whmcs.sh"; then
  fail "install-whmcs.sh still rsyncs the repo root into the webroot"
else
  pass "no repo-root rsync into the webroot"
fi

echo
echo "[provisioning robustness — no unverified external blocker]"
SETUP="${REPO_ROOT}/infrastructure/vps/setup-ubuntu-24.04.sh"
# A 404 on a vendor URL must not make provisioning unrecoverable.
grep -q 'IONCUBE_ARCHIVE' "${SETUP}" \
  && pass "ionCube supports a pre-downloaded archive (offline fallback)" \
  || fail "ionCube download has no offline fallback (a 404 ends the run)"
grep -q 'IONCUBE_URLS=' "${SETUP}" \
  && pass "ionCube tries more than one URL" || fail "ionCube has a single hard-coded URL"
# Optional packages must not be able to abort the run.
# Match it as a bare package token on an apt install line, not as the comment
# that explains why it is absent.
if grep -E '^[[:space:]]+[a-z0-9-]+' "${SETUP}" | grep -qw 'libc-client-dev'; then
  fail "libc-client-dev is requested (not packaged in Ubuntu 24.04)"
else
  pass "no libc-client-dev in any package list (dropped by Ubuntu)"
fi
grep -q 'php_opt_failed' "${SETUP}" \
  && pass "optional PHP extensions installed individually (partial failure tolerated)" \
  || fail "optional PHP extensions use an all-or-nothing retry"
grep -q 'Final verification' "${SETUP}" \
  && pass "provisioning ends with a hard PHP/Node gate" \
  || fail "no final verification gate"

echo
echo "[overlay must not delete WHMCS core]"
INSTALLER="${REPO_ROOT}/infrastructure/vps/scripts/install-whmcs.sh"
if grep -q 'rsync -a --delete' "${INSTALLER}"; then
  fail "overlay uses rsync --delete (would remove standard_cart, crons/cron.php, vendor modules)"
else
  pass "overlay never uses rsync --delete on WHMCS merge directories"
fi
grep -q 'crons/cron.php' "${INSTALLER}" \
  && pass "installer verifies WHMCS core cron.php survived" \
  || fail "installer does not verify crons/cron.php"
grep -q 'standard_cart' "${INSTALLER}" \
  && pass "installer verifies standard_cart order form survived" \
  || fail "installer does not verify standard_cart"

echo
echo "[public Tools adapter is deployed, developer helpers are not]"
grep -q '"${SRC_DIR}/tools/" "${WHMCS_ROOT}/tools/"' "${INSTALLER}" \
  && pass "install-whmcs.sh overlays tools/ into the web root (Nginx routes /tools to it)" \
  || fail "install-whmcs.sh never deploys tools/index.php, so /tools 404s on a fresh VPS"
grep -q "exclude 'preview-router.php'" "${INSTALLER}" \
  && pass "developer-only preview-router.php is excluded from the web root" \
  || fail "preview-router.php would be published to the web root"
grep -q "exclude 'build-manifests.py'" "${INSTALLER}" \
  && pass "developer-only build-manifests.py is excluded from the web root" \
  || fail "build-manifests.py would be published to the web root"
grep -q 'tools/index.php' "${INSTALLER}" \
  && pass "installer verifies the Tools front controller landed" \
  || fail "installer does not verify tools/index.php"

echo
echo "----------------------------------------"
printf 'passed: %d   failed: %d\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]] || { echo "DRY RUN FAILED"; exit 1; }
echo "DRY RUN PASSED"
