#!/usr/bin/env bash
# Build a pre-compiled upload package for cPanel "Setup Node.js App".
#
# Shared hosting often kills `npm run build` (TypeScript + Vite) for exceeding memory/process
# limits. This script does the build locally/in CI and packages only what the server runs, so the
# server only has to install production dependencies ("Run NPM Install" button or `npm ci --omit=dev`).
#
# Usage (from cloudhost247-node/):   bash scripts/package-cpanel.sh
# Output:                            release/cloudhost247-cpanel-<git-sha>.zip
# See docs/CPANEL_DEPLOYMENT.md, section "Pre-built package (recommended)".
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
NAME="cloudhost247-cpanel-${SHA}"
OUT_DIR="${APP_DIR}/release"
STAGE="$(mktemp -d)/${NAME}"

echo "==> Installing build dependencies from lockfile"
npm ci --no-audit --no-fund

echo "==> Building server (dist/) and frontend (public/)"
rm -rf dist public/assets public/index.html
npm run build

echo "==> Staging runtime files"
mkdir -p "${STAGE}/database" "${STAGE}/docs"
cp -R dist public manifests "${STAGE}/"
cp -R database/migrations "${STAGE}/database/"
cp server.js package.json package-lock.json .env.example "${STAGE}/"
# The startup file's error messages point at docs/CPANEL_DEPLOYMENT.md — ship the app-root copy so
# the path resolves inside <APP_ROOT>, not only in a full Git checkout.
cp docs/CPANEL_DEPLOYMENT.md "${STAGE}/docs/"
cat > "${STAGE}/DEPLOY.txt" <<'EOF'
CloudHost247 cPanel release package
===================================

STOP — read this before clicking Restart in Setup Node.js App.

This folder is NOT the application root. Move its CONTENTS into the application root you
configured in cPanel (for example /home/<user>/cloudhost247), so that:

  <APP_ROOT>/server.js
  <APP_ROOT>/dist/src/server.js
  <APP_ROOT>/public/index.html
  <APP_ROOT>/package.json
  <APP_ROOT>/docs/CPANEL_DEPLOYMENT.md

all sit DIRECTLY in <APP_ROOT>. Leaving this folder nested one level deeper is the most common
cause of the repeating "Compiled application not found at dist/src/server.js" error in stderr.log.

After moving the files:
  1. In the app's virtual-environment terminal run: npm ci --omit=dev
  2. Configure NODE_ENV, APP_URL, DATABASE_URL, DATABASE_SSL, JWT_SECRET,
     CREDENTIAL_ENCRYPTION_KEY (see .env.example). Do NOT set PORT; Passenger supplies it.
  3. Restart the application.
  4. Verify /health and /ready.

No server-side "npm run build" is needed: dist/ and public/ are already compiled in this zip.
Full instructions: docs/CPANEL_DEPLOYMENT.md
EOF
# Source maps are useful for stack traces but not required; keep them (small).

# The WHMCS adapter lives at the WHMCS web root, NOT inside the Node application.
# Ship it as a separately named overlay so operators cannot accidentally overwrite WHMCS core.
TOOLS_STAGE="$(dirname "${STAGE}")/cloudhost247-whmcs-tools-overlay"
mkdir -p "${TOOLS_STAGE}/assets" "${TOOLS_STAGE}/tools" "${TOOLS_STAGE}/templates/cloudhost247"
cp -R ../assets/cloudhost247-tools "${TOOLS_STAGE}/assets/"
cp ../tools/index.php ../tools/.htaccess "${TOOLS_STAGE}/tools/"
cp ../templates/cloudhost247/cloudhost247-tools.tpl "${TOOLS_STAGE}/templates/cloudhost247/"
# Requires the matching theme/module sources from this Git revision; see TOOLS-ARCHITECTURE.md.
cp ../docs/tools/TOOLS-ARCHITECTURE.md "${TOOLS_STAGE}/DEPLOYMENT.md"
mkdir -p "${OUT_DIR}"
( cd "$(dirname "${STAGE}")" && zip -qr "${OUT_DIR}/cloudhost247-whmcs-tools-${SHA}.zip" cloudhost247-whmcs-tools-overlay )
rm -f "${OUT_DIR}/${NAME}.zip"
( cd "$(dirname "${STAGE}")" && zip -qr "${OUT_DIR}/${NAME}.zip" "${NAME}" )

echo "==> Done: release/${NAME}.zip ($(du -h "${OUT_DIR}/${NAME}.zip" | cut -f1))"
echo "    Upload it to cPanel, extract, and move the CONTENTS of ${NAME}/ into your app root."
echo "    DEPLOY.txt inside the zip repeats the nested-folder warning; docs/CPANEL_DEPLOYMENT.md is included."
