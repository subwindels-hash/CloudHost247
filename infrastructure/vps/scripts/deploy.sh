#!/usr/bin/env bash
# CloudHost247 — VPS deployment (git pull → build → migrate → restart).
#
# Deploys the Node platform to /opt/cloudhost247 and restarts systemd services.
# WHMCS PHP files are deployed separately via install-whmcs.sh (overlay) or
# `git pull` + rsync of the WHMCS-path files; this script handles the Node app
# (build, migrations, service restart) and verifies health afterwards.
#
# Usage:
#   sudo bash infrastructure/vps/scripts/deploy.sh              # deploy current HEAD
#   sudo bash infrastructure/vps/scripts/deploy.sh --rollback   # restore last good build
#
# Every deploy snapshots the previous dist/ + public/ + package-lock.json into
# $APP_ROOT/.previous-build, so --rollback returns to the last build that
# passed the healthcheck without a git revert.
#
# Environment overrides:
#   APP_ROOT=/opt/cloudhost247 SRC_DIR=<repo checkout>
#   SKIP_BUILD=1 (restart only, no rebuild)
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/cloudhost247}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
SKIP_BUILD="${SKIP_BUILD:-0}"
PREVIOUS="${APP_ROOT}/.previous-build"
MODE="deploy"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash ...)."
[[ -d "${SRC_DIR}/cloudhost247-node" ]] || die "SRC_DIR does not contain cloudhost247-node: ${SRC_DIR}"
[[ -f "${APP_ROOT}/.env" ]] || die "Missing ${APP_ROOT}/.env — create it from cloudhost247-node/.env.example (docs/VPS_DEPLOYMENT.md §6)."

if [[ "${1:-}" == "--rollback" ]]; then
  MODE="rollback"
  log "Rolling back to the last good build in ${PREVIOUS}"
  [[ -d "${PREVIOUS}" ]] || die "No previous build at ${PREVIOUS}. Roll back with git instead."
  systemctl stop cloudhost247-node cloudhost247-worker || true
  rm -rf "${APP_ROOT}/dist" "${APP_ROOT}/public"
  cp -a "${PREVIOUS}/dist" "${PREVIOUS}/public" "${APP_ROOT}/"
  [[ -f "${PREVIOUS}/package-lock.json" ]] && cp -a "${PREVIOUS}/package-lock.json" "${APP_ROOT}/" || true
  chown -R cloudhost247:cloudhost247 "${APP_ROOT}"
  systemctl start cloudhost247-node cloudhost247-worker
  sleep 3
  systemctl is-active --quiet cloudhost247-node || die "Rollback started the service but it immediately failed. Check: journalctl -u cloudhost247-node -n 50"
  bash "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh" \
    || die "Rolled back, but the healthcheck still fails — escalate (docs/VPS_DEPLOYMENT.md §9)."
  log "Rollback complete."
  exit 0
fi

log "Pulling latest code into ${SRC_DIR}"
git -C "${SRC_DIR}" fetch origin
git -C "${SRC_DIR}" status --short
git -C "${SRC_DIR}" pull --ff-only || die "git pull failed (non-fast-forward?). Resolve manually, then re-run."

log "Syncing Node platform to ${APP_ROOT}"
# Exclude secrets, node_modules, and build output from the sync.
rsync -a --delete \
  --exclude '.env' --exclude 'node_modules' --exclude 'dist' --exclude 'public' \
  --exclude '.git' --exclude 'release' \
  "${SRC_DIR}/cloudhost247-node/" "${APP_ROOT}/"
chown -R cloudhost247:cloudhost247 "${APP_ROOT}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  # Snapshot the currently-serving build before overwriting it (see --rollback).
  if [[ -d "${APP_ROOT}/dist" ]]; then
    log "Snapshotting the current build to ${PREVIOUS}"
    rm -rf "${PREVIOUS}"
    mkdir -p "${PREVIOUS}"
    cp -a "${APP_ROOT}/dist" "${PREVIOUS}/"
    [[ -d "${APP_ROOT}/public" ]] && cp -a "${APP_ROOT}/public" "${PREVIOUS}/"
    [[ -f "${APP_ROOT}/package-lock.json" ]] && cp -a "${APP_ROOT}/package-lock.json" "${PREVIOUS}/"
  fi

  log "Installing dependencies and building (TypeScript + Vite)"
  sudo -u cloudhost247 bash -c "cd ${APP_ROOT} && npm ci --no-audit --no-fund && npm run build" \
    || { rm -rf "${APP_ROOT}/dist"; [[ -d "${PREVIOUS}/dist" ]] && cp -a "${PREVIOUS}/dist" "${APP_ROOT}/"; die "Build failed; the previous build was restored and services were not restarted."; }
fi

log "Running database migrations (status → verify → up → verify)"
# Order follows DEPLOYMENT-CHECKLIST.md: never apply DDL without first seeing
# the pending set and confirming no checksum drift. CONFIRM_MIGRATION=yes is
# the documented production gate; taking a backup first is the operator's job
# (backup.sh, or BACKUP_S3_* in the control plane).
sudo -u cloudhost247 bash -c "cd ${APP_ROOT} && npm run migrate:status"
sudo -u cloudhost247 bash -c "cd ${APP_ROOT} && npm run migrate:verify" \
  || die "Migration checksum drift detected. Do NOT continue. Investigate with 'npm run migrate:status' (docs/VPS_DEPLOYMENT.md §9)."
sudo -u cloudhost247 bash -c "cd ${APP_ROOT} && CONFIRM_MIGRATION=yes npm run migrate" \
  || die "Migration failed. Services were NOT restarted; the previous build is still live."
sudo -u cloudhost247 bash -c "cd ${APP_ROOT} && npm run migrate:verify"

log "Restarting systemd services"
systemctl restart cloudhost247-node
systemctl restart cloudhost247-worker
sleep 3
systemctl is-active --quiet cloudhost247-node || die "cloudhost247-node failed to start. Check: journalctl -u cloudhost247-node -n 50"
systemctl is-active --quiet cloudhost247-worker || die "cloudhost247-worker failed to start. Check: journalctl -u cloudhost247-worker -n 50"

log "Reloading Nginx (vhost changes, if any)"
nginx -t && systemctl reload nginx

log "Verifying health"
bash "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh" \
  || die "Healthcheck failed after deploy. Restore the last good build with: $0 --rollback"

log "Deploy complete."
