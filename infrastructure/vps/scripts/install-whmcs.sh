#!/usr/bin/env bash
# CloudHost247 — WHMCS 8.x core + CloudHost247 overlay installer (Ubuntu 24.04 VPS).
#
# WHMCS is commercial software: download the ZIP from whmcs.com (your licensed
# account) and pass its path. This script:
#   1. Verifies PHP 8.2 + ionCube + MySQL are ready (setup-ubuntu-24.04.sh).
#   2. Extracts WHMCS core into /var/www/whmcs (never overwrites configuration.php).
#   3. Overlays the CloudHost247 customizations from this repo (templates/,
#      modules/, crons/, lang/, config/, root *.php) — reviewed file list only.
#   4. Fixes ownership/permissions (templates_c, attachments, downloads).
#   5. Prints the WHMCS web-installer URL + activation order (docs/VPS_DEPLOYMENT.md).
#
# Usage:
#   sudo bash infrastructure/vps/scripts/install-whmcs.sh /root/whmcs.zip
#
# Environment overrides:
#   WHMCS_ROOT=/var/www/whmcs SRC_DIR=<repo checkout> DOMAIN=cloudhost247.com
set -euo pipefail

WHMCS_ROOT="${WHMCS_ROOT:-/var/www/whmcs}"
DOMAIN="${DOMAIN:-cloudhost247.com}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
WHMCS_ZIP="${1:-}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ -n "${WHMCS_ZIP}" ]] || die "Usage: $0 /path/to/whmcs.zip (download from whmcs.com)."
[[ -f "${WHMCS_ZIP}" ]] || die "WHMCS ZIP not found: ${WHMCS_ZIP}"
[[ -d "${SRC_DIR}/templates" ]] || die "SRC_DIR does not look like the CloudHost247 repo: ${SRC_DIR}"
[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash ...)."

log "Verifying runtime (PHP 8.2 + ionCube + MySQL)"
php -v | head -n 1
php -m | grep -qi ioncube || die "ionCube Loader not loaded. Re-run setup-ubuntu-24.04.sh."
mysql --version | head -n 1
php -m | grep -qi pdo_mysql || die "pdo_mysql missing. Re-run setup-ubuntu-24.04.sh."

log "Extracting WHMCS core to ${WHMCS_ROOT} (preserving configuration.php)"
mkdir -p "${WHMCS_ROOT}"
tmpdir="$(mktemp -d)"
unzip -q "${WHMCS_ZIP}" -d "${tmpdir}"
# WHMCS ZIP extracts to a single top-level folder (e.g. whmcs-8.x/); handle both
# layouts. NOT `[[ -d "${tmpdir}/whmcs"* ]]`: -d does not glob, and bash compares
# the quoted prefix literally against the expanded word list, so that test is
# always false. The find therefore never ran, WHMCS_SRC stayed ${tmpdir}, and
# init.php was looked for one level too high — so this installer failed on every
# real WHMCS archive. ask find directly; it handles both layouts and cannot glob
# wrongly.
WHMCS_SRC="${tmpdir}"
nested_whmcs="$(find "${tmpdir}" -maxdepth 1 -type d -name 'whmcs*' | head -n 1)"
[[ -n "${nested_whmcs}" ]] && WHMCS_SRC="${nested_whmcs}"
[[ -f "${WHMCS_SRC}/init.php" ]] || die "WHMCS core not found in ZIP (init.php missing)."
# Never overwrite an existing configuration.php (holds DB creds + licence key).
if [[ -f "${WHMCS_ROOT}/configuration.php" ]]; then
  cp "${WHMCS_ROOT}/configuration.php" "${tmpdir}/configuration.php.bak"
fi
rsync -a --exclude 'configuration.php' "${WHMCS_SRC}/" "${WHMCS_ROOT}/"
if [[ -f "${tmpdir}/configuration.php.bak" ]]; then
  cp "${tmpdir}/configuration.php.bak" "${WHMCS_ROOT}/configuration.php"
fi
rm -rf "${tmpdir}"

log "Overlaying CloudHost247 customizations (reviewed file list)"
# Only WHMCS-path files are overlaid. Never copy docs/, tests/, scripts/,
# cloudhost247-node/, .git, or internal reports into the webroot.
#
# NO --delete, deliberately. These are WHMCS merge directories: rsync --delete
# would remove stock WHMCS content this repo does not ship, e.g.
#   templates/orderforms/standard_cart/  (ovh_cart falls back to it)
#   crons/cron.php                       (WHMCS's own 5-minute cron — the file
#                                         our cron entry executes)
#   modules/{addons,servers,gateways}/*  (vendor modules in use)
# which would break the ordering system and WHMCS automation. Files this repo
# does ship are overwritten (rsync's default is update-by-copy), and obsolete
# files are removed by a reviewed list instead of by blanket deletion.
for item in templates modules crons lang config; do
  [[ -d "${SRC_DIR}/${item}" ]] || continue
  rsync -a --itemize-changes "${SRC_DIR}/${item}/" "${WHMCS_ROOT}/${item}/"
done
# Root WHMCS pages (86 routes) + robots.txt. Deliberately a flat glob, not a
# recursive rsync: a recursive copy swept tests/, infrastructure/,
# cloudhost247-node/ and scripts/ into the public webroot, leaking Node
# sources, docs and internal reports (forbidden by docs/DEPLOYMENT-GUIDE.md).
shopt -s nullglob
root_pages=("${SRC_DIR}"/*.php "${SRC_DIR}"/robots.txt)
shopt -u nullglob
((${#root_pages[@]})) || die "No root WHMCS pages found in ${SRC_DIR} — wrong SRC_DIR?"
cp -f "${root_pages[@]}" "${WHMCS_ROOT}/"
echo "  copied ${#root_pages[@]} root file(s)"
# Theme assets, error pages and sitemap/robots files served from the root.
for extra in assets errors; do
  [[ -d "${SRC_DIR}/${extra}" ]] && rsync -a "${SRC_DIR}/${extra}/" "${WHMCS_ROOT}/${extra}/" || true
done
shopt -s nullglob
root_xml=("${SRC_DIR}"/*.xml)
shopt -u nullglob
((${#root_xml[@]})) && cp -f "${root_xml[@]}" "${WHMCS_ROOT}/" || true

log "Verifying WHMCS core survived the overlay"
[[ -f "${WHMCS_ROOT}/crons/cron.php" ]] || \
  die "WHMCS core cron.php missing after overlay — the WHMCS ZIP may be incomplete. The 5-minute cron entry depends on it."
[[ -d "${WHMCS_ROOT}/templates/orderforms/standard_cart" ]] || \
  die "WHMCS core standard_cart order form missing — ovh_cart falls back to it."
echo "  WHMCS core files present (crons/cron.php, standard_cart)"

log "Fixing ownership and permissions"
chown -R www-data:www-data "${WHMCS_ROOT}"
mkdir -p "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"
chown -R www-data:www-data "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"
chmod 775 "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"
# configuration.php holds the DB password + licence key: readable by the web
# server and root only (Nginx already denies it as a direct request target).
chmod 640 "${WHMCS_ROOT}/configuration.php" 2>/dev/null || true

log "WHMCS overlay complete."
cat <<EOF

Next steps:
  1. Point DNS ${DOMAIN} → this VPS IP, then issue certificates:
       certbot certonly --webroot -w /var/www/letsencrypt -d ${DOMAIN} -d www.${DOMAIN}
     then: systemctl reload nginx
  2. Open https://${DOMAIN}/install/ in a browser and complete the WHMCS
     web installer (database: create it first — see docs/VPS_DEPLOYMENT.md §4).
  3. Delete the install directory: rm -rf ${WHMCS_ROOT}/install
  4. Activate WHMCS modules following docs/INSTALLATION-GUIDE.md §4.2 (the
     single source of truth for activation order); the VPS-specific gotchas
     are listed in docs/VPS_DEPLOYMENT.md §7.
  5. Verify: bash ${SRC_DIR}/infrastructure/vps/scripts/healthcheck.sh
EOF
