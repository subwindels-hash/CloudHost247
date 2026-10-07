#!/usr/bin/env bash
# Verify that a built cPanel package really is the current website rebuild, before it is uploaded.
#
# Why: the live site once sat three merges behind while every deploy "succeeded", because the
# package that got uploaded was an older build (see docs/website-rebuild/LIVE-SITE-DEPLOYMENT.md).
# A package is identified by its compiled shell, not by its filename or its timestamp, so this
# script opens the archive and checks the properties that differ between a rebuild and a stale
# build. It runs on any machine with `unzip` and bash — no Node, no npm, no network.
#
# Usage:
#   bash scripts/verify-cpanel-package.sh                       # newest release/cloudhost247-cpanel-*.zip
#   bash scripts/verify-cpanel-package.sh release/cloudhost247-cpanel-283b2f0.zip
#   bash scripts/verify-cpanel-package.sh --quiet release/<zip> # only the failures + final line
#
# Exit code 0 only when every check passes.
set -euo pipefail

QUIET=0
if [ "${1:-}" = "--quiet" ]; then QUIET=1; shift; fi

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

ZIP="${1:-}"
if [ -z "$ZIP" ]; then
  ZIP="$(ls -t release/cloudhost247-cpanel-*.zip 2>/dev/null | head -1 || true)"
fi
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then
  echo "No package found. Build one first:  bash scripts/package-cpanel.sh" >&2
  exit 2
fi

# The rebuilt static shell, committed in frontend/index.html. The pre-rebuild build's shell reads
# "CloudHost247 — Cloud hosting, built for your next idea"; uploading that reproduces the old site.
EXPECTED_TITLE='CloudHost247 — Hosting, Cloud, Domains &amp; Developer Platform'
STALE_TITLE='CloudHost247 — Cloud hosting, built for your next idea'
# Deleted by the rebuild. Its presence in a bundle means the package predates the rebuild.
STALE_MARKER='Not yet built on this platform'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$ZIP" -d "$WORK"
ROOT="$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | head -1)"
if [ -z "$ROOT" ]; then
  echo "FAIL  the archive has no top-level directory" >&2
  exit 1
fi

FAILED=0
pass() { [ "$QUIET" = 1 ] || printf '  PASS  %-30s %s\n' "$1" "$2"; }
fail() { printf '  FAIL  %-30s %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

[ "$QUIET" = 1 ] || echo "Verifying $(basename "$ZIP")"
[ "$QUIET" = 1 ] || echo

# --- The package is a complete application ------------------------------------------------------
for required in server.js package.json package-lock.json .env.example dist/src/app.js \
                dist/src/routes/navigation.js dist/src/routes/seo.js public/index.html; do
  if [ -f "$ROOT/$required" ]; then pass "runtime file" "$required"
  else fail "runtime file" "$required is missing"; fi
done

# --- The shell is the rebuild, not a pre-rebuild build -------------------------------------------
TITLE="$(grep -o '<title>[^<]*</title>' "$ROOT/public/index.html" | head -1 | sed 's/<\/*title>//g')"
if [ "$TITLE" = "$STALE_TITLE" ]; then
  fail "shell is rebuilt" "the package is PRE-REBUILD (its shell reads \"$STALE_TITLE\") — do not upload it"
elif [ "$TITLE" = "$EXPECTED_TITLE" ]; then
  pass "shell is rebuilt" "$TITLE"
else
  fail "shell is rebuilt" "unexpected shell title: '$TITLE'"
fi

# The entry bundle the shell names must exist inside the package (a shell without its bundle ships
# a blank page).
ENTRY="$( { grep -o 'src="/assets/index-[^"]*\.js"' "$ROOT/public/index.html" 2>/dev/null || true; } | head -1 | sed 's/src="//; s/"$//')"
if [ -n "$ENTRY" ] && [ -f "$ROOT/public$ENTRY" ]; then
  pass "entry bundle present" "$ENTRY"
else
  fail "entry bundle present" "shell references '${ENTRY:-nothing}' but the file is not in the package"
fi

# --- Pre-rebuild content cannot be inside any shipped bundle -------------------------------------
if grep -rl "$STALE_MARKER" "$ROOT/public/assets/" >/dev/null 2>&1; then
  fail "no pre-rebuild content" "'$STALE_MARKER' is still shipped in $(grep -rl "$STALE_MARKER" "$ROOT/public/assets/" | head -1)"
else
  pass "no pre-rebuild content" "the rebuild's deleted copy is absent"
fi

# --- The rebuild's assets and schema are inside --------------------------------------------------
MEDIA="$( { find "$ROOT/public/media" -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
JPG3D="$( { find "$ROOT/public/media" -name '*-3d.jpg' 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [ "$MEDIA" -ge 150 ] && [ "$JPG3D" -ge 15 ]; then
  pass "media tree shipped" "$MEDIA files, $JPG3D 3D visuals"
else
  fail "media tree shipped" "only $MEDIA media files ($JPG3D 3D) — expected the rebuild's media tree"
fi

PACKED_MIGRATIONS="$( { ls "$ROOT/database/migrations" 2>/dev/null || true; } | wc -l | tr -d ' ')"
SOURCE_MIGRATIONS="$( { ls database/migrations 2>/dev/null || true; } | wc -l | tr -d ' ')"
if [ "$PACKED_MIGRATIONS" = "$SOURCE_MIGRATIONS" ]; then
  pass "migrations complete" "$PACKED_MIGRATIONS (matches the source tree)"
else
  fail "migrations complete" "package has $PACKED_MIGRATIONS, source has $SOURCE_MIGRATIONS"
fi

# --- The package is the checkout's own build, not an older one -----------------------------------
# Every check above answers "is this a complete rebuild?"; they cannot tell two rebuilds apart, so a
# package built from an earlier commit passes them all (and one such package really did pass, two
# commits behind, while `release/` still held it). A one-commit-old upload is exactly the failure
# this script exists to prevent, so the compiled trees are compared file by file against the
# checkout the package would be deployed from. `package-cpanel.sh` builds before it zips, so after a
# build these directories are present; when they are not (a fresh clone, no npm install), the check
# says so instead of pretending to have compared something.
LOCAL_BUILT=0
if [ -d public/assets ] && [ -d dist/src ]; then LOCAL_BUILT=1; fi
if [ "$LOCAL_BUILT" = 1 ]; then
  DRIFT="$( { diff -rq --exclude='*.map' "$ROOT/public" public 2>/dev/null || true; } | head -4)"
  DRIFT="${DRIFT}$( { diff -rq --exclude='*.map' "$ROOT/dist" dist 2>/dev/null || true; } | head -4)"
  if [ -z "$DRIFT" ]; then
    pass "matches this checkout" "public/ and dist/ are byte-identical to the current build"
  else
    fail "matches this checkout" "the package was built from different source (run bash scripts/package-cpanel.sh again): $(echo "$DRIFT" | head -1)"
  fi
else
  pass "matches this checkout" "skipped: public/ and dist/ are not built here (run npm run build first)"
fi

# --- Nothing secret is inside --------------------------------------------------------------------
if unzip -l "$ZIP" | grep -qE '(^|/)\.env$'; then
  fail "no .env" "the archive contains .env — never ship the environment file"
else
  pass "no .env" "configuration stays on the server"
fi

echo
if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED check(s) failed — do NOT upload $ZIP."
  echo "Rebuild it from the checkout you intend to deploy: bash scripts/package-cpanel.sh"
  exit 1
fi
echo "OK — $(basename "$ZIP") is the current rebuild and is complete."
echo "Upload it over the application root, keep .env, restart the app, then run:"
echo "  python3 scripts/verify-live-site.py --base https://<your-domain>/"
