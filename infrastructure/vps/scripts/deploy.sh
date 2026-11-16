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
#   AUTHORIZED_MIGRATIONS=0041  (comma-separated quarantine versions to apply;
#                               REQUIRED on a fresh database — see below)
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/cloudhost247}"
APP_USER="${APP_USER:-cloudhost247}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
SKIP_BUILD="${SKIP_BUILD:-0}"
PREVIOUS="${APP_ROOT}/.previous-build"
MODE="deploy"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash ...)."
[[ -d "${SRC_DIR}/cloudhost247-node" ]] || die "SRC_DIR does not contain cloudhost247-node: ${SRC_DIR}"
[[ -f "${APP_ROOT}/.env" ]] || die "Missing ${APP_ROOT}/.env — create it from cloudhost247-node/.env.example (docs/VPS_DEPLOYMENT.md §6)."
# The build runs as ${APP_USER} inside the checkout, so the checkout must be
# traversable and writable by that account. /root is 0700 root — building there
# fails with a confusing EACCES halfway through `npm run build`.
case "${SRC_DIR}" in
  /root|/root/*) die "SRC_DIR must not live under /root (${SRC_DIR}): the unprivileged build user cannot traverse it. Move the checkout to e.g. /opt/cloudhost247-src." ;;
esac

if [[ "${1:-}" == "--rollback" ]]; then
  MODE="rollback"
  log "Rolling back to the last good build in ${PREVIOUS}"
  [[ -d "${PREVIOUS}" ]] || die "No previous build at ${PREVIOUS}. Roll back with git instead."
  systemctl stop cloudhost247-node cloudhost247-worker || true
  rm -rf "${APP_ROOT}/dist" "${APP_ROOT}/public"
  cp -a "${PREVIOUS}/dist" "${PREVIOUS}/public" "${APP_ROOT}/"
  [[ -f "${PREVIOUS}/package-lock.json" ]] && cp -a "${PREVIOUS}/package-lock.json" "${APP_ROOT}/" || true
  chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"
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
  --exclude '.git' --exclude 'release' --exclude '.previous-build' \
  "${SRC_DIR}/cloudhost247-node/" "${APP_ROOT}/"
chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"

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

  # BUILD IN THE REPO CHECKOUT, NOT IN ${APP_ROOT}. This is not a preference.
  #
  # The build writes outside cloudhost247-node/: script `tools:catalog:check`
  # regenerates modules/addons/cloudhost247_theme/resources/tools.json, and
  # `build:tools` emits assets/cloudhost247-tools/. Both paths are resolved as
  # ../../<x> from the app directory, i.e. they are REPO-root paths. ${APP_ROOT}
  # is /opt/cloudhost247 and contains only that one subdirectory, so there
  # ../../modules resolves to /opt/modules and the build either dies with
  # ENOENT or silently writes into /opt. Worse, `npm run build` runs
  # tools:catalog:check BEFORE build:server, so it fails before producing a
  # single byte of dist/ — which is exactly what a real VPS deploy hit.
  #
  # The checkout has the correct layout, so build there and copy the build
  # outputs into ${APP_ROOT}. devDependencies (tsc, vite, tsx) are needed for
  # this and are then discarded.
  log "Installing dependencies and building (TypeScript + Vite) in ${SRC_DIR}"
  # The build user must own the app directory AND be able to write the two
  # repo-root projection targets: modules/addons/cloudhost247_theme/resources
  # (tools:catalog) and assets/cloudhost247-tools (build:tools, created on
  # demand). chown the parents non-recursively so nothing unrelated to the
  # build is re-owned, and best-effort the generated dirs themselves.
  chown -R "${APP_USER:-cloudhost247}:${APP_USER:-cloudhost247}" "${SRC_DIR}/cloudhost247-node"
  chown "${APP_USER:-cloudhost247}:${APP_USER:-cloudhost247}" \
    "${SRC_DIR}" "${SRC_DIR}/assets" "${SRC_DIR}/modules/addons/cloudhost247_theme" \
    "${SRC_DIR}/modules/addons/cloudhost247_theme/resources" 2>/dev/null || true
  chown -R "${APP_USER:-cloudhost247}:${APP_USER:-cloudhost247}" \
    "${SRC_DIR}/assets/cloudhost247-tools" 2>/dev/null || true
  sudo -u "${APP_USER:-cloudhost247}" bash -c "cd ${SRC_DIR}/cloudhost247-node && npm ci --no-audit --no-fund && npm run build" \
    || { rm -rf "${APP_ROOT}/dist"; [[ -d "${PREVIOUS}/dist" ]] && cp -a "${PREVIOUS}/dist" "${APP_ROOT}/"; die "Build failed; the previous build was restored and services were not restarted."; }

  log "Installing runtime-only dependencies in ${APP_ROOT}"
  # The service runs the compiled app; it needs dependencies, not compilers.
  # --omit=dev drops tsc/vite/vitest/playwright and the browser binaries.
  sudo -u "${APP_USER:-cloudhost247}" bash -c "cd ${APP_ROOT} && npm ci --omit=dev --no-audit --no-fund" \
    || die "Installing runtime dependencies failed. Services were NOT restarted."

  log "Publishing build output to ${APP_ROOT}"
  for out in dist public; do
    [[ -d "${SRC_DIR}/cloudhost247-node/${out}" ]] || die "Build produced no ${out}/ — refusing to publish a broken build."
    rm -rf "${APP_ROOT:?}/${out}"
    cp -a "${SRC_DIR}/cloudhost247-node/${out}" "${APP_ROOT}/"
  done
  # The compiled app resolves paths relative to its own directory and loads
  # <APP_ROOT>/.env (which rsync excludes), so ownership must be reset here.
  chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"
fi

log "Running database migrations (status → verify → up → verify)"
# Order follows DEPLOYMENT-CHECKLIST.md: never apply DDL without first seeing
# the pending set and confirming no checksum drift. CONFIRM_MIGRATION=yes is
# the documented production gate; taking a backup first is the operator's job
# (backup.sh, or BACKUP_S3_* in the control plane).
sudo -u "${APP_USER:-cloudhost247}" bash -c "cd ${APP_ROOT} && npm run migrate:status"
sudo -u "${APP_USER:-cloudhost247}" bash -c "cd ${APP_ROOT} && npm run migrate:verify" \
  || die "Migration checksum drift detected. Do NOT continue. Investigate with 'npm run migrate:status' (docs/VPS_DEPLOYMENT.md §9)."

# A production migration run REFUSES to apply anything while a quarantined
# migration (currently 0041) is pending and has pending dependents — it fails
# closed before executing any DDL rather than committing a partial upgrade.
# On a fresh database that is every migration, so the schema would stay empty
# and the app would serve 503s over a nonexistent schema. Capture the output so
# the operator gets the real reason instead of "migration failed".
MIGRATE_OUT="$(mktemp)"
if ! sudo -u "${APP_USER:-cloudhost247}" bash -c "cd ${APP_ROOT} && CONFIRM_MIGRATION=yes ${AUTHORIZED_MIGRATIONS:+AUTHORIZED_MIGRATIONS=${AUTHORIZED_MIGRATIONS}} npm run migrate" 2>&1 | tee "${MIGRATE_OUT}"; then
  if grep -qi 'quarantin' "${MIGRATE_OUT}"; then
    QUARANTINED_IDS="$(grep -oiE '[0-9]{4} \([^)]+\) is quarantined' "${MIGRATE_OUT}" \
      | grep -oE '^[0-9]{4}' | sort -u | tr '\n' ' ')"
    [[ -n "${QUARANTINED_IDS}" ]] || QUARANTINED_IDS="$(grep -oE '\b00[0-9]{2}\b' "${MIGRATE_OUT}" | sort -u | tr '\n' ' ')"
    rm -f "${MIGRATE_OUT}"
    die "Migrations are blocked by a standing quarantine, not by a SQL error.

  The pending quarantine rule(s) affect: ${QUARANTINED_IDS:-see output above}
  Recording the refusal is correct behaviour — the runner fails closed rather
  than half-upgrading the schema. Resolve it deliberately:

    a) Review the standing restriction in docs/NODE_PLATFORM_STATUS.md
       ('Standing restrictions') and confirm the artifacts are authorized.

    b) Apply them explicitly for this run (one line):

         sudo AUTHORIZED_MIGRATIONS=<comma-separated versions> bash infrastructure/vps/scripts/deploy.sh

       e.g. AUTHORIZED_MIGRATIONS=0041 for a fresh database — 0042, 0043, 0047,
       0048, 0049, 0051, 0052, 0054, 0056 and 0059 depend on it.

  Nothing was restarted; the previous build is still live and the schema is
  unchanged. See docs/VPS_DEPLOYMENT.md §9."
  fi
  rm -f "${MIGRATE_OUT}"
  die "Migration failed for a reason other than quarantine (see the SQL error above). Services were NOT restarted; the previous build is still live."
fi
rm -f "${MIGRATE_OUT}"
sudo -u "${APP_USER:-cloudhost247}" bash -c "cd ${APP_ROOT} && npm run migrate:verify"

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
