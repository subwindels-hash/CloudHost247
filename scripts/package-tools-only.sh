#!/usr/bin/env bash
# Package ONLY the files that fix the PHP/WHMCS tool pages, as a drop-in upload.
#
# Why this exists next to scripts/package-cpanel.sh: the tool pages are served by two different
# deployments on the same domain, and the two fail differently.
#
#   * /tools             -> the Node platform application (a React page). Fixed by the full cPanel
#                           package; the endpoint it calls is /api/tools/catalog.
#   * /tools/<slug>      -> the PHP/WHMCS theme (tools/index.php + tools/lib/View.php + the theme
#                           template). Fixed by the files in this archive. This surface is NOT
#                           touched by the Node package at all: uploading dist/ and public/ changes
#                           nothing about it.
#
# The PHP bundle used to run `await response.json()` with no guard, so an HTML answer (a login
# redirect, a web-server error page, a 404) surfaced as `Unexpected token '<', "<!doctype "... is
# not valid JSON` in the result panel. The fixed bundle names what came back instead. The version
# query string is bumped so browsers actually fetch the new file.
#
# Usage:  bash scripts/package-tools-only.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
APP_DIR="$ROOT/cloudhost247-node"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
OUT="$APP_DIR/release"
ZIP="$OUT/cloudhost247-tools-only-${SHA}.zip"
mkdir -p "$OUT"

FILES=(
  "templates/cloudhost247/js/tools.js"
  "templates/cloudhost247/cloudhost247-tools.tpl"
  "tools/lib/View.php"
  "assets/cloudhost247-tools/tools.js"
  "assets/cloudhost247-tools/tools.css"
)

for file in "${FILES[@]}"; do
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
done

# The theme bundle must carry the guard; a package built from a tree without it is worthless.
if ! grep -q "readJsonResponse" templates/cloudhost247/js/tools.js; then
  echo "templates/cloudhost247/js/tools.js has no JSON guard — refusing to package" >&2
  exit 1
fi
if grep -q "await response.json()" templates/cloudhost247/js/tools.js; then
  echo "templates/cloudhost247/js/tools.js still parses unguarded — refusing to package" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
README="$STAGE/PACKAGE-README.txt"
trap 'rm -rf "$STAGE"' EXIT
cat > "$README" <<'TXT'
CloudHost247 — PHP/WHMCS tool pages fix (drop-in)

Upload each file over the SAME path on the server, overwriting the old copy:

  templates/cloudhost247/js/tools.js            <- the tool pages' script (the fix)
  templates/cloudhost247/cloudhost247-tools.tpl <- loads it with a new ?v= so browsers re-fetch
  tools/lib/View.php                            <- same version bump for the no-theme renderer
  assets/cloudhost247-tools/tools.js            <- the shared tools bundle, if this site serves it
  assets/cloudhost247-tools/tools.css           <- its stylesheet (unchanged, shipped together)

Keep no backups in the web root (a backup named tools.js.bak is still served by Apache).

What changes: when the tools API answers with something that is not JSON — a login redirect, an
HTML error page, a 404 — the page now says which of those happened instead of showing
"Unexpected token '<', "<!doctype "... is not valid JSON".

This is NOT the website rebuild. The Node application (/tools, the homepage, the catalogue pages)
is deployed with release/cloudhost247-cpanel-<sha>.zip and restarted in Setup Node.js App.

After uploading, open one tool page and run a check. If the result panel still shows the old
sentence, the browser is serving a cached copy: hard-reload once (Ctrl/Cmd+Shift+R).
TXT

rm -f "$ZIP"
( cd "$STAGE" && zip -q "$ZIP" PACKAGE-README.txt )
zip -q "$ZIP" "${FILES[@]}"

echo "Wrote $ZIP"
echo "(the cPanel package lives in the same directory: cloudhost247-node/release/)"
unzip -l "$ZIP" | sed -n '3,12p'
