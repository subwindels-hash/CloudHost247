#!/usr/bin/env bash
#
# READ-ONLY production state check for the Phase 5 checkpoint decision.
# Thin wrapper around recovery/check-production-state.sql — all the logic lives
# in the .sql file so you can inspect every statement before running it, or run
# it directly with psql if you prefer.
#
# Every statement is a SELECT inside a READ ONLY transaction. Nothing is
# created, altered or deleted. Safe against live production.
#
# Usage:
#   export DATABASE_URL='postgresql://user:pass@host:5432/dbname'
#   bash recovery/check-production-state.sh
#
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  echo "  export DATABASE_URL='postgresql://user:pass@host:5432/dbname'" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found on PATH." >&2
  echo "  On cPanel this is often at /usr/pgsql-*/bin/psql — add it to PATH, or run:" >&2
  echo "    psql \"\$DATABASE_URL\" -X -f recovery/check-production-state.sql" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==============================================================="
echo " CloudHost247 — Phase 5 production state check (READ ONLY)"
echo " $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "==============================================================="

psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=0 -f "$SCRIPT_DIR/check-production-state.sql"

echo
echo "==============================================================="
echo " Interpretation notes are at the bottom of"
echo " recovery/check-production-state.sql"
echo "==============================================================="
