#!/usr/bin/env bash
# Build a pre-compiled upload package for the Ubuntu 24.04 VPS deployment.
#
# Standard VPS deployments build directly in /opt/cloudhost247-src via
# infrastructure/vps/scripts/deploy.sh. This script is for operators who prefer
# to compile in CI or on a workstation and upload runtime-only files for the
# Ubuntu 24.04 VPS target (Nginx + systemd, PORT=3000).
#
# Usage (from cloudhost247-node/):   bash scripts/package-vps.sh
# Output:                            release/cloudhost247-vps-<git-sha>.zip
# See docs/VPS_DEPLOYMENT.md.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
NAME="cloudhost247-vps-${SHA}"
OUT_DIR="${APP_DIR}/release"
STAGE_PARENT="$(mktemp -d)"
STAGE="${STAGE_PARENT}/${NAME}"
trap 'rm -rf "${STAGE_PARENT}"' EXIT

echo "==> Installing build dependencies from lockfile"
npm ci --no-audit --no-fund

echo "==> Building server (dist/) and frontend (public/)"
rm -rf dist public/assets public/index.html
npm run build

echo "==> Staging runtime files"
mkdir -p "${STAGE}/database" "${STAGE}/docs"
cp -R dist public manifests config "${STAGE}/"
cp -R database/migrations "${STAGE}/database/"
cp package.json package-lock.json .env.example DEPLOYMENT_GUIDE.md "${STAGE}/"
cp ../docs/VPS_DEPLOYMENT.md "${STAGE}/docs/" 2>/dev/null || true
cat > "${STAGE}/DEPLOY.txt" <<'EOF'
CloudHost247 VPS release package (Ubuntu 24.04 + Nginx + systemd)
================================================================

This folder is NOT the application root. Move its CONTENTS into the
application root (default /opt/cloudhost247), so that:

  /opt/cloudhost247/dist/src/server.js
  /opt/cloudhost247/dist/src/worker/main.js
  /opt/cloudhost247/public/index.html
  /opt/cloudhost247/package.json
  /opt/cloudhost247/docs/VPS_DEPLOYMENT.md

all sit DIRECTLY in /opt/cloudhost247 (owned by cloudhost247:cloudhost247).

After moving the files:
  1. Install production dependencies:
       sudo -u cloudhost247 bash -c 'cd /opt/cloudhost247 && npm ci --omit=dev --no-audit --no-fund'
  2. Create /opt/cloudhost247/.env (mode 0600) from .env.example (PORT=3000,
     APP_URL, DATABASE_URL, JWT_SECRET, CREDENTIAL_ENCRYPTION_KEY).
     Nginx proxies 127.0.0.1:3000.
  3. Run migrations (on a fresh database, review docs/VPS_DEPLOYMENT.md §6 and
     include AUTHORIZED_MIGRATIONS=0041):
       sudo -u cloudhost247 bash -c 'cd /opt/cloudhost247 && CONFIRM_MIGRATION=yes npm run migrate'
       sudo -u cloudhost247 bash -c 'cd /opt/cloudhost247 && npm run migrate:verify'
  4. Restart systemd units:
       sudo systemctl restart cloudhost247-node cloudhost247-worker
  5. Verify health & readiness:
       curl -fsS http://127.0.0.1:3000/health && curl -fsS http://127.0.0.1:3000/ready

No server-side "npm run build" is needed: dist/ and public/ are already
compiled in this zip. See docs/VPS_DEPLOYMENT.md for the full runbook.
EOF

echo "==> Zipping ${NAME}.zip"
mkdir -p "${OUT_DIR}"
(cd "${STAGE_PARENT}" && zip -qr "${OUT_DIR}/${NAME}.zip" "${NAME}")
echo "Created ${OUT_DIR}/${NAME}.zip"
ls -lh "${OUT_DIR}/${NAME}.zip"
