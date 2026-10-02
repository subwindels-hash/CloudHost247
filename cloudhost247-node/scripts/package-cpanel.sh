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

mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}/${NAME}.zip"
( cd "$(dirname "${STAGE}")" && zip -qr "${OUT_DIR}/${NAME}.zip" "${NAME}" )

echo "==> Done: release/${NAME}.zip ($(du -h "${OUT_DIR}/${NAME}.zip" | cut -f1))"
echo "    Upload it to cPanel, extract, and move the contents of ${NAME}/ into your app root."
