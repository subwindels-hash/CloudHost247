#!/bin/bash
# CloudHost247 Platform - Deployment Verification Script
#
# This script verifies that the platform is properly deployed and running.
# Run this after deployment to diagnose 503 errors.
#
# Usage:
#   chmod +x scripts/verify-deployment.sh
#   ./scripts/verify-deployment.sh [domain]
#
# Example:
#   ./scripts/verify-deployment.sh try.vortexprecisionit.com

set -e

DOMAIN="${1:-localhost:3000}"
PROTOCOL="https"

# Use http for localhost
if [[ "$DOMAIN" == *"localhost"* ]] || [[ "$DOMAIN" == *"127.0.0.1"* ]]; then
  PROTOCOL="http"
fi

BASE_URL="${PROTOCOL}://${DOMAIN}"

echo "=========================================="
echo "CloudHost247 Platform Deployment Verification"
echo "=========================================="
echo "Domain: $DOMAIN"
echo "URL: $BASE_URL"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_endpoint() {
  local endpoint=$1
  local expected_status=${2:-200}
  local description=$3
  
  printf "%-40s" "$description"
  
  response=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "${BASE_URL}${endpoint}" 2>/dev/null || echo "000")
  
  if [ "$response" == "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} (HTTP $response)"
    return 0
  elif [ "$response" == "503" ]; then
    echo -e "${RED}✗ FAIL${NC} (HTTP 503 - Service Unavailable)"
    echo "  → Application is not running. Check cPanel → Setup Node.js App"
    return 1
  elif [ "$response" == "000" ]; then
    echo -e "${RED}✗ FAIL${NC} (Connection failed)"
    echo "  → Cannot connect to server. Check DNS and firewall."
    return 1
  else
    echo -e "${YELLOW}⚠ WARN${NC} (HTTP $response, expected $expected_status)"
    return 1
  fi
}

echo "1. Checking health endpoints..."
echo "----------------------------------------"
check_endpoint "/health" 200 "Health check (liveness)"
check_endpoint "/ready" 200 "Readiness check (storage)"
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
check_endpoint "/api/v1/meta" 200 "API metadata"
check_endpoint "/api/v1/public/site-info" 200 "Site info"
echo ""

echo "4. Checking static assets..."
echo "----------------------------------------"
check_endpoint "/favicon.svg" 200 "Favicon"
check_endpoint "/manifest.webmanifest" 200 "PWA manifest"
check_endpoint "/assets/css/site.css" 200 "CSS stylesheet"
echo ""

echo "5. Testing response headers..."
echo "----------------------------------------"
headers=$(curl -sI -m 10 "${BASE_URL}/" 2>/dev/null || echo "")

if echo "$headers" | grep -q "X-Content-Type-Options"; then
  echo -e "${GREEN}✓ PASS${NC} Security headers present"
else
  echo -e "${YELLOW}⚠ WARN${NC} Security headers missing"
fi

if echo "$headers" | grep -q "X-Request-Id"; then
  echo -e "${GREEN}✓ PASS${NC} Request ID tracking enabled"
else
  echo -e "${YELLOW}⚠ WARN${NC} Request ID missing"
fi
echo ""

echo "6. Checking for common 503 causes..."
echo "----------------------------------------"

# Check if it's a generic 503 page
response_body=$(curl -s -m 10 "${BASE_URL}/" 2>/dev/null || echo "")

if echo "$response_body" | grep -q "Error 503"; then
  echo -e "${RED}✗ FAIL${NC} Generic 503 error detected"
  echo "  → The Node.js application is not running or crashed on startup"
  echo "  → Check cPanel → Setup Node.js App → Application logs"
  echo ""
  echo "  Common causes:"
  echo "    1. Missing JWT_SECRET environment variable"
  echo "    2. Wrong Node.js version (need >= 22.20.0)"
  echo "    3. Missing dependencies (run: npm ci --omit=dev)"
  echo "    4. Application not started in cPanel"
  echo ""
  echo "  Quick fixes:"
  echo "    1. Set JWT_SECRET in cPanel environment variables:"
  echo "       node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
  echo "    2. Update Node.js version to 22.x in cPanel"
  echo "    3. Restart the application in cPanel"
  echo ""
  echo "  See: TROUBLESHOOTING-503.md for detailed help"
elif echo "$response_body" | grep -q "CloudHost247"; then
  echo -e "${GREEN}✓ PASS${NC} CloudHost247 platform is responding"
else
  echo -e "${YELLOW}⚠ WARN${NC} Unexpected response (not CloudHost247)"
fi
echo ""

echo "=========================================="
echo "Verification complete!"
echo "=========================================="
echo ""
echo "If you see 503 errors, run this checklist:"
echo "  1. Check cPanel → Setup Node.js App → is application running?"
echo "  2. Check application logs for startup errors"
echo "  3. Verify environment variables (especially JWT_SECRET)"
echo "  4. Verify Node.js version (>= 22.20.0)"
echo "  5. Run: npm ci --omit=dev"
echo "  6. Restart the application"
echo ""
echo "Documentation:"
echo "  - TROUBLESHOOTING-503.md"
echo "  - docs/CPANEL_DEPLOYMENT.md"
echo "  - platform/README.md"
