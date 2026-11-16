#!/usr/bin/env bash
# CloudHost247 Platform — VPS Deployment Verification Script
#
# Verifies that a deployed CloudHost247 platform instance is reachable behind
# Nginx + systemd on an Ubuntu 24.04 VPS (or locally during development).
# For full host-level checks on the VPS (systemd, PHP-FPM, MySQL, PostgreSQL, TLS),
# run: bash infrastructure/vps/scripts/healthcheck.sh
#
# Usage:
#   bash platform/scripts/verify-deployment.sh [domain]
#
# Example:
#   bash platform/scripts/verify-deployment.sh app.cloudhost247.com

set -euo pipefail

DOMAIN="${1:-localhost:3000}"
PROTOCOL="https"

if [[ "$DOMAIN" == *"localhost"* ]] || [[ "$DOMAIN" == *"127.0.0.1"* ]]; then
  PROTOCOL="http"
fi

BASE_URL="${PROTOCOL}://${DOMAIN}"

echo "=========================================="
echo "CloudHost247 VPS Deployment Verification"
echo "=========================================="
echo "Domain: $DOMAIN"
echo "URL:    $BASE_URL"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FAILURES=0

check_endpoint() {
  local endpoint=$1
  local expected_status=${2:-200}
  local description=$3

  printf "%-40s" "$description"

  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "${BASE_URL}${endpoint}" 2>/dev/null || true)
  [[ "$response" =~ ^[0-9]{3}$ ]] || response="000"

  if [[ "$response" == "$expected_status" ]]; then
    echo -e "${GREEN}PASS${NC} (HTTP $response)"
    return 0
  elif [[ "$response" == "502" || "$response" == "503" ]]; then
    echo -e "${RED}FAIL${NC} (HTTP $response - Upstream/Service Unavailable)"
    echo "  -> Check systemd on the VPS: sudo systemctl status cloudhost247-node"
    echo "  -> Inspect logs: sudo journalctl -u cloudhost247-node -n 50 --no-pager"
    FAILURES=$((FAILURES + 1))
    return 0
  elif [[ "$response" == "000" ]]; then
    echo -e "${RED}FAIL${NC} (Connection failed)"
    echo "  -> Cannot connect to server. Check DNS, UFW (80/443), and Nginx."
    FAILURES=$((FAILURES + 1))
    return 0
  else
    echo -e "${YELLOW}WARN${NC} (HTTP $response, expected $expected_status)"
    FAILURES=$((FAILURES + 1))
    return 0
  fi
}

echo "1. Checking health endpoints..."
echo "----------------------------------------"
check_endpoint "/health" 200 "Health check (liveness)"
check_endpoint "/ready" 200 "Readiness check (PostgreSQL + schema)"
echo ""

echo "2. Checking public pages..."
echo "----------------------------------------"
check_endpoint "/" 200 "Homepage"
check_endpoint "/hosting" 200 "Hosting page"
check_endpoint "/pricing" 200 "Pricing page"
check_endpoint "/about" 200 "About page"
echo ""

echo "3. Checking API endpoints..."
echo "----------------------------------------"
check_endpoint "/api" 200 "API index"
check_endpoint "/api/v1/public/status" 200 "Public system status"
echo ""

echo "4. Checking static assets & headers..."
echo "----------------------------------------"
headers=$(curl -sI -m 10 "${BASE_URL}/" 2>/dev/null || true)
if grep -qi "x-content-type-options" <<<"$headers"; then
  echo -e "${GREEN}PASS${NC} Security headers present"
else
  echo -e "${YELLOW}WARN${NC} Security headers missing"
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "=========================================="
if [[ "$FAILURES" -eq 0 ]]; then
  echo "Verification PASSED"
  exit 0
else
  echo "Verification finished with $FAILURES warning(s)/failure(s)."
  echo "See docs/VPS_DEPLOYMENT.md and platform/TROUBLESHOOTING-503.md."
  exit 1
fi
