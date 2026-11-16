#!/usr/bin/env bash
# CloudHost247 — VPS restore (verified, dry-run by default).
#
# Restores a backup.sh archive (MySQL + PostgreSQL + files). Safe by default:
# without --confirm it prints what WOULD happen and exits. With --confirm it:
#   1. Verifies the SHA-256 checksum.
#   2. Stops cloudhost247-node + worker.
#   3. Restores MySQL + PostgreSQL dumps.
#   4. Restores file trees (preserving configuration.php + .env).
#   5. Restarts services and runs healthcheck.
#
# Usage:
#   sudo bash infrastructure/vps/scripts/restore.sh /var/backups/cloudhost247/cloudhost247-<stamp>.tar.gz [--confirm]
#
# Environment overrides:
#   WHMCS_ROOT=/var/www/whmcs APP_ROOT=/opt/cloudhost247
#   WHMCS_DB_USER=root WHMCS_DB_NAME=whmcs NODE_DB_NAME=cloudhost247   (socket auth as root)
set -euo pipefail

WHMCS_ROOT="${WHMCS_ROOT:-/var/www/whmcs}"
APP_ROOT="${APP_ROOT:-/opt/cloudhost247}"
WHMCS_DB_USER="${WHMCS_DB_USER:-root}"
WHMCS_DB_NAME="${WHMCS_DB_NAME:-whmcs}"
NODE_DB_NAME="${NODE_DB_NAME:-cloudhost247}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ARCHIVE="${1:-}"
CONFIRM="${2:-}"
[[ -n "${ARCHIVE}" ]] || die "Usage: $0 /path/to/backup.tar.gz [--confirm]"
[[ -f "${ARCHIVE}" ]] || die "Backup archive not found: ${ARCHIVE}"
[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash ...)."

log "Verifying checksum"
sha256sum -c "${ARCHIVE}.sha256" || die "Checksum verification failed. Archive is corrupt."

if [[ "${CONFIRM}" != "--confirm" ]]; then
  cat <<EOF
DRY RUN — no changes made. To restore for real, re-run with --confirm:

  sudo bash $0 ${ARCHIVE} --confirm

This will:
  1. Stop cloudhost247-node + cloudhost247-worker
  2. Restore MySQL (${WHMCS_DB_NAME}) from whmcs.sql.gz
  3. Restore PostgreSQL (${NODE_DB_NAME}) from node.dump
  4. Restore WHMCS files to ${WHMCS_ROOT} (preserving configuration.php)
  5. Restore Node files to ${APP_ROOT} (preserving .env)
  6. Restart services + run healthcheck

Take a fresh backup first (backup.sh) if you have not already.
EOF
  exit 0
fi

STAGE="$(mktemp -d)"
tar -xzf "${ARCHIVE}" -C "${STAGE}"

log "Stopping services"
systemctl stop cloudhost247-node cloudhost247-worker || true

log "Restoring MySQL (WHMCS)"
gunzip -c "${STAGE}/whmcs.sql.gz" | mysql -u "${WHMCS_DB_USER}" "${WHMCS_DB_NAME}"

log "Restoring PostgreSQL (Node)"
# Same peer-auth rule as backup.sh: run as the postgres OS user, no -U flag.
# pg_restore needs to read the dump, so stage it where postgres can read it.
install -m 600 -o postgres -g postgres "${STAGE}/node.dump" /tmp/ch247-restore.dump
# No --no-owner: the dump records cloudhost247 as the owner and postgres is a
# superuser, so ownership is restored correctly and the app keeps its access.
sudo -u postgres pg_restore -d "${NODE_DB_NAME}" --clean --if-exists /tmp/ch247-restore.dump
rm -f /tmp/ch247-restore.dump

log "Restoring WHMCS files (preserving configuration.php)"
if [[ -f "${WHMCS_ROOT}/configuration.php" ]]; then
  cp "${WHMCS_ROOT}/configuration.php" "${STAGE}/configuration.php.bak"
fi
tar -xzf "${STAGE}/whmcs-files.tar.gz" -C "$(dirname "${WHMCS_ROOT}")"
if [[ -f "${STAGE}/configuration.php.bak" ]]; then
  cp "${STAGE}/configuration.php.bak" "${WHMCS_ROOT}/configuration.php"
fi
chown -R www-data:www-data "${WHMCS_ROOT}"
mkdir -p "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"
chown -R www-data:www-data "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"

log "Restoring Node files (preserving .env)"
if [[ -f "${APP_ROOT}/.env" ]]; then
  cp "${APP_ROOT}/.env" "${STAGE}/node.env.bak"
fi
tar -xzf "${STAGE}/node-files.tar.gz" -C "$(dirname "${APP_ROOT}")"
if [[ -f "${STAGE}/node.env.bak" ]]; then
  cp "${STAGE}/node.env.bak" "${APP_ROOT}/.env"
fi
chown -R cloudhost247:cloudhost247 "${APP_ROOT}"

log "Restarting services"
systemctl start cloudhost247-node cloudhost247-worker
sleep 3
systemctl is-active --quiet cloudhost247-node || die "cloudhost247-node failed to start after restore."
systemctl is-active --quiet cloudhost247-worker || die "cloudhost247-worker failed to start after restore."

log "Verifying health"
bash "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh" || die "Healthcheck failed after restore."

rm -rf "${STAGE}"
log "Restore complete."
