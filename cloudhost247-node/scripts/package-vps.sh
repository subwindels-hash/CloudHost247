#!/usr/bin/env bash
# Build a pre-compiled upload package for the Ubuntu 24.04 VPS deployment.
#
# Unlike cPanel shared hosting (which can kill `npm run build` under CloudLinux
# LVE limits), a VPS with root can build on the server. This script is for
# operators who prefer to build locally/in CI and ship only runtime files —
# a pre-built release layout intended for the Ubuntu 24.04 VPS target, with the
# layout (systemd + Nginx, PORT=3000, no Passenger).
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
STAGE="$(mktemp -d)/${NAME}"

echo "==> Installing build dependencies from lockfile"
npm ci --no-audit --no-fund

echo "==> Building server (dist/) and frontend (public/)"
rm -rf dist public/assets public/index.html
npm run build

echo "==> Staging runtime files"
mkdir -p "${STAGE}/database" "${STAGE}/docs"
cp -R dist public manifests config "${STAGE}/"
cp -R database/migrations "${STAGE}/database/"
cp server.js package.json package-lock.json .env.example "${STAGE}/"
# The VPS guide ships with the package so server.js error links resolve on the server.
cp ../docs/VPS_DEPLOYMENT.md "${STAGE}/docs/" 2>/dev/null || true
cat > "${STAGE}/DEPLOY.txt" <<'EOF'
CloudHost247 VPS release package (Ubuntu 24.04 + Nginx + systemd)
================================================================

This folder is NOT the application root. Move its CONTENTS into the
application root (default /opt/cloudhost247), so that:

  /opt/cloudhost247/server.js
  /opt/cloudhost247/dist/src/server.js
  /opt/cloudhost247/public/index.html
  /opt/cloudhost247/package.json
  /opt/cloudhost247/docs/VPS_DEPLOYMENT.md

all sit DIRECTLY in /opt/cloudhost247.

After moving the files:
  1. As root: npm ci --omit=dev  (or: sudo -u cloudhost247 npm ci --omit=dev)
  2. Create /opt/cloudhost247/.env from .env.example (PORT=3000, APP_URL,
     DATABASE_URL, JWT_SECRET, CREDENTIAL_ENCRYPTION_KEY). Do NOT set
     SOCKET_PATH; Nginx proxies 127.0.0.1:3000.
  3. Run migrations: CONFIRM_MIGRATION=yes npm run migrate
  4. Restart: systemctl restart cloudhost247-node cloudhost247-worker
  5. Verify: curl http://127.0.0.1:3000/health && curl http://127.0.0.1:3000/ready

No server-side "npm run build" is needed: dist/ and public/ are already
compiled in this zip. See docs/VPS_DEPLOYMENT.md for the full runbook.
EOF

echo "==> Zipping ${NAME}.zip"
mkdir -p "${OUT_DIR}"
(cd "$(dirname "${STAGE}")" && zip -qr "${OUT_DIR}/${NAME}.zip" "${NAME}")
echo "Created ${OUT_DIR}/${NAME}.zip"
ls -lh "${OUT_DIR}/${NAME}.zip"
