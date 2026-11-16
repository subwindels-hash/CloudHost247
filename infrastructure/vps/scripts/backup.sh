#!/usr/bin/env bash
# CloudHost247 — VPS backup (MySQL + PostgreSQL + files, checksummed).
#
# Creates /var/backups/cloudhost247/cloudhost247-<timestamp>.tar.gz containing:
#   - MySQL dump (WHMCS)          — mysqldump --single-transaction
#   - PostgreSQL dump (Node)      — pg_dump -Fc (custom format)
#   - WHMCS files (excl. templates_c cache)
#   - Node .env + manifests (NOT node_modules/dist — rebuilt by deploy.sh)
#   - SHA-256 checksum sidecar (.sha256)
#
# Retention: deletes archives older than RETENTION_DAYS (default 30).
# Off-server upload (S3/R2) is handled by the Node control plane's backup job
# (BACKUP_S3_* env) for server-agent archives; this script is the host-level
# safety net. Run via cron (infrastructure/vps/cron/cloudhost247.cron).
#
# Usage:
#   sudo bash infrastructure/vps/scripts/backup.sh
#
# Environment overrides:
#   WHMCS_ROOT=/var/www/whmcs APP_ROOT=/opt/cloudhost247
#   BACKUP_DIR=/var/backups/cloudhost247 RETENTION_DAYS=30
#   WHMCS_DB_USER=root WHMCS_DB_NAME=whmcs NODE_DB_NAME=cloudhost247   (socket auth as root)
set -euo pipefail

WHMCS_ROOT="${WHMCS_ROOT:-/var/www/whmcs}"
APP_ROOT="${APP_ROOT:-/opt/cloudhost247}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cloudhost247}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# MySQL root authenticates over the local socket (auth_socket) when this script
# runs as root, so no password is stored on disk. Override only if you created
# a dedicated dump user with credentials in /root/.my.cnf.
WHMCS_DB_USER="${WHMCS_DB_USER:-root}"
WHMCS_DB_NAME="${WHMCS_DB_NAME:-whmcs}"
NODE_DB_NAME="${NODE_DB_NAME:-cloudhost247}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash ...)."
mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d)"
ARCHIVE="${BACKUP_DIR}/cloudhost247-${STAMP}.tar.gz"

log "Dumping MySQL (WHMCS: ${WHMCS_DB_NAME})"
# --single-transaction: consistent InnoDB snapshot without locking the site.
# --set-gtid-purged=OFF keeps the dump restorable on a server with GTID enabled.
mysqldump --single-transaction --quick --routines --triggers --events \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 \
  -u "${WHMCS_DB_USER}" "${WHMCS_DB_NAME}" | gzip > "${STAGE}/whmcs.sql.gz"
# Fail loudly on an empty/truncated dump rather than shipping a useless archive.
gzip -t "${STAGE}/whmcs.sql.gz" || die "MySQL dump is not a valid gzip stream."

log "Dumping PostgreSQL (Node: ${NODE_DB_NAME})"
# Run AS the postgres OS user and do NOT pass -U: Ubuntu's default local
# pg_hba rule is `local all all peer`, so `-U cloudhost247` from the postgres
# account fails peer authentication. postgres is a superuser and can dump any
# database this way.
sudo -u postgres pg_dump -Fc "${NODE_DB_NAME}" > "${STAGE}/node.dump"

log "Archiving files"
tar -czf "${STAGE}/whmcs-files.tar.gz" \
  --exclude 'templates_c/*' --exclude 'install' \
  -C "$(dirname "${WHMCS_ROOT}")" "$(basename "${WHMCS_ROOT}")"
tar -czf "${STAGE}/node-files.tar.gz" \
  --exclude 'node_modules' --exclude 'dist' --exclude 'public' \
  -C "$(dirname "${APP_ROOT}")" "$(basename "${APP_ROOT}")"

log "Creating checksummed archive"
tar -czf "${ARCHIVE}" -C "${STAGE}" .
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
cat "${ARCHIVE}.sha256"
rm -rf "${STAGE}"

log "Pruning archives older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'cloudhost247-*.tar.gz' -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name 'cloudhost247-*.tar.gz.sha256' -mtime +"${RETENTION_DAYS}" -delete

log "Backup complete: ${ARCHIVE}"
