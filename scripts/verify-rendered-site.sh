#!/usr/bin/env bash
# Render every published page into real Smarty output, then audit the HTML a visitor and a crawler
# actually receive.
#
# Why this exists: `tests/website/check-fixtures.py` and `scripts/check-hero-render.py` read rendered
# fixtures, and nothing rendered them. The release candidate could therefore pass while the head of
# every page, the canonical address of every page and the hero artwork of every page went unchecked —
# the static suites cannot see markup, only the template source that produces it. This script closes
# that gap with one command, on a host that has PHP (native, or the WebAssembly interpreter in
# scripts/php-wasm) and nothing else.
#
# Usage:
#     bash scripts/verify-rendered-site.sh               # use a cached or CH247_SMARTY_PATH Smarty
#     bash scripts/verify-rendered-site.sh --fetch       # download the pinned Smarty first
#     CH247_SMARTY_PATH=/path/to/smarty bash scripts/verify-rendered-site.sh
#
# What it does NOT do: it does not start WHMCS, does not touch a database or a session, and simulates
# no checkout, authentication or provisioning behaviour. It renders the shipped theme components with
# the arrays the PHP pages publish, which is what makes a head, an image ladder or a heading outline
# checkable without a licensed install.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

SMARTY_VERSION='4.5.6'
# The tarball GitHub serves for the `v4.5.6` tag. Pinned by digest: a verification tool that installs
# whatever the network returns is a supply-chain hole in a gate that exists to prove the tree is the
# tree. Re-cut this pair deliberately, with the reason, if the version ever moves.
SMARTY_SHA256='f617b86983b3c7115222c44d63d874630f9d4b4bd88cf1ef603b3ab138c67079'
SMARTY_URL="https://codeload.github.com/smarty-php/smarty/tar.gz/refs/tags/v${SMARTY_VERSION}"
CACHE_DIR="${CH247_CACHE_DIR:-$ROOT/.cache}"
SMARTY_DIR="$CACHE_DIR/smarty-$SMARTY_VERSION"
FIXTURE_DIR="${CH247_FIXTURE_DIR:-$CACHE_DIR/fixtures}"

fetch=0
[ "${1:-}" = '--fetch' ] && fetch=1

# --- the PHP the harness runs on ------------------------------------------------------------------
# Native PHP if there is one, otherwise the repository's own WebAssembly interpreter, which needs
# only Node. The shim reports real exit codes (see scripts/php-wasm/README.md), so a fatal parse
# error fails this script instead of printing a success.
if command -v php >/dev/null 2>&1; then
  PHP_BIN='php'
elif [ -x "$ROOT/scripts/php-wasm/php" ]; then
  PHP_BIN="$ROOT/scripts/php-wasm/php"
  echo "note: no native php on PATH; using the WebAssembly interpreter (first run installs it)."
else
  echo 'verify-rendered-site: no php and no scripts/php-wasm/php — cannot render the site.' >&2
  exit 2
fi

# --- Smarty ---------------------------------------------------------------------------------------
if [ -n "${CH247_SMARTY_PATH:-}" ]; then
  SMARTY_DIR="$CH247_SMARTY_PATH"
fi

if [ ! -f "$SMARTY_DIR/libs/Smarty.class.php" ] && [ "$fetch" = 1 ]; then
  echo "fetching Smarty $SMARTY_VERSION into $SMARTY_DIR"
  mkdir -p "$CACHE_DIR"
  tarball="$CACHE_DIR/smarty-$SMARTY_VERSION.tar.gz"
  if [ ! -f "$tarball" ]; then
    curl -fsSL -o "$tarball" "$SMARTY_URL"
  fi
  actual="$(sha256sum "$tarball" | awk '{print $1}')"
  if [ "$actual" != "$SMARTY_SHA256" ]; then
    echo "verify-rendered-site: Smarty $SMARTY_VERSION tarball digest mismatch." >&2
    echo "  expected $SMARTY_SHA256" >&2
    echo "  actual   $actual" >&2
    rm -f "$tarball"
    exit 2
  fi
  rm -rf "$SMARTY_DIR"
  mkdir -p "$SMARTY_DIR"
  tar xzf "$tarball" -C "$SMARTY_DIR" --strip-components=1
fi

if [ ! -f "$SMARTY_DIR/libs/Smarty.class.php" ]; then
  cat >&2 <<EOF
verify-rendered-site: Smarty is not available, so the rendered-site audit cannot run.

  git-ignored cache expected : $SMARTY_DIR/libs/Smarty.class.php
  or point CH247_SMARTY_PATH at an extracted Smarty >= 4 with a libs/ directory.

Obtain it once with:

  bash scripts/verify-rendered-site.sh --fetch

The download is pinned to Smarty $SMARTY_VERSION and verified against its SHA-256 before use.
EOF
  exit 2
fi

# --- render ---------------------------------------------------------------------------------------
mkdir -p "$FIXTURE_DIR"
echo "== rendering every published page =="
CH247_SMARTY_PATH="$SMARTY_DIR" CH247_FIXTURE_DIR="$FIXTURE_DIR" "$PHP_BIN" tests/website/render-fixtures.php

echo
echo '== auditing the rendered HTML =='
CH247_FIXTURE_DIR="$FIXTURE_DIR" python3 tests/website/check-fixtures.py
echo
CH247_FIXTURE_DIR="$FIXTURE_DIR" python3 scripts/check-hero-render.py

# The Tools menu and footer are enriched at runtime from the platform's catalogue, and site.js
# resolves every anchor it appends against this origin. `site.json` publishes the paths the theme
# believes this shell answers; this asks the shell. Both directions matter and neither is visible to
# a static audit, because the anchors do not exist until the browser makes them.
echo
echo '== resolving the published tool surface =='
"$PHP_BIN" tests/website/check-tools-resolution.php

echo
echo "verify-rendered-site: rendered-site audit passed (fixtures in $FIXTURE_DIR)."
