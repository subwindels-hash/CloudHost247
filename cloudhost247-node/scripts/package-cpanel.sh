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
mkdir -p "${STAGE}/database"
cp -R dist public manifests "${STAGE}/"
cp -R database/migrations "${STAGE}/database/"
cp server.js package.json package-lock.json .env.example "${STAGE}/"
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

# Every build is verified as a package before it is announced as done: the live site once sat three
# merges behind because a stale archive was uploaded and nothing checked the bytes inside it.
bash "${APP_DIR}/scripts/verify-cpanel-package.sh" "${OUT_DIR}/${NAME}.zip"

echo "==> Done: release/${NAME}.zip ($(du -h "${OUT_DIR}/${NAME}.zip" | cut -f1))"
echo "    Upload it to cPanel, extract, and move the contents of ${NAME}/ into your app root."
