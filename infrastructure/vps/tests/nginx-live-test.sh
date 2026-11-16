#!/usr/bin/env bash
# CloudHost247 — live nginx integration test for the VPS vhosts.
#
# This is NOT a static check. It builds/starts a real nginx, loads the actual
# vhosts from infrastructure/vps/nginx/ into /etc/nginx, and asserts on the
# HTTP responses: security denies, ACME reachability, pretty-URL routing, the
# /tools/ front controller, header inheritance, single Cache-Control, proxy
# headers, and HTTP/2.
#
# It is destructive to /etc/nginx and /etc/letsencrypt, so it MUST run in a
# throwaway container/VM — never on a live host. Requires root.
#
# Usage (in a disposable Ubuntu 24.04 container):
#   sudo bash infrastructure/vps/tests/nginx-live-test.sh
#
# In CI this runs inside a container built from the repo; see
# .github/workflows/vps-stack.yml. Locally it needs: nginx, openssl, curl,
# python3 (for the stub Node backend).
#
# Exit 0 = every assertion passed.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NGINX_DIR="${REPO_ROOT}/infrastructure/vps/nginx"
DOMAIN="cloudhost247.com"
APP_DOMAIN="app.cloudhost247.com"
NGINX_BIN="${NGINX_BIN:-nginx}"
WEBROOT="${WEBROOT:-/var/www/whmcs}"
NODE_PORT="${NODE_PORT:-3000}"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }

[[ "$(id -u)" -eq 0 ]] || { echo "Run as root inside a disposable container." >&2; exit 2; }

cleanup() {
  [[ -n "${NGINX_PIDFILE:-}" ]] && "$NGINX_BIN" -p /etc/nginx -c "${SCRATCH}/nginx.conf" -s stop >/dev/null 2>&1
  [[ -n "${STUB_PID:-}" ]] && kill "${STUB_PID}" 2>/dev/null
  rm -rf "${SCRATCH:-}"
}
trap cleanup EXIT

SCRATCH="$(mktemp -d)"
echo "CloudHost247 — live nginx integration test"
echo "nginx:   $("$NGINX_BIN" -v 2>&1)"
echo "webroot: ${WEBROOT}"
echo

# ---------------------------------------------------------------- fixtures ---
echo "[fixtures]"
mkdir -p "${WEBROOT}"/{assets,templates_c,attachments,tools/data} /var/www/letsencrypt
printf 'SECRET=database-password\n'            > "${WEBROOT}/.env"
printf '<?php echo "INDEX";\n'                 > "${WEBROOT}/index.php"
printf '<?php echo "TOOLS-INDEX";\n'           > "${WEBROOT}/tools/index.php"
printf '{"db":"credentials","licence":"X"}\n'  > "${WEBROOT}/configuration.php"
printf 'cached\n'                              > "${WEBROOT}/templates_c/compiled.php"
printf 'pdf\n'                                 > "${WEBROOT}/attachments/invoice.pdf"
printf 'internal\n'                            > "${WEBROOT}/tools/data/secret.json"
printf 'body{color:red}\n'                     > "${WEBROOT}/assets/site.css"
printf '<urlset/>\n'                           > "${WEBROOT}/sitemap.xml"
mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
printf 'acme-token-value' > /var/www/letsencrypt/.well-known/acme-challenge/token
chmod -R a+rX /var/www
pass "fixtures written under ${WEBROOT}"

# Self-signed certs, exactly as setup-ubuntu-24.04.sh bootstraps them before
# Certbot runs (this is what makes `nginx -t` green on a fresh host).
for d in "${DOMAIN}" "${APP_DOMAIN}"; do
  mkdir -p "/etc/letsencrypt/live/${d}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 2 \
    -keyout "/etc/letsencrypt/live/${d}/privkey.pem" \
    -out    "/etc/letsencrypt/live/${d}/fullchain.pem" \
    -subj "/CN=${d}" >/dev/null 2>&1
  cp "/etc/letsencrypt/live/${d}/fullchain.pem" "/etc/letsencrypt/live/${d}/chain.pem"
done
pass "bootstrap self-signed certs created (pre-Certbot state)"

# Stub Node backend: proves the reverse proxy forwards path, Host, XFF, proto.
cat > "${SCRATCH}/stub-node.py" <<'PYEOF'
import http.server, socketserver, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({
            "path": self.path,
            "host": self.headers.get("Host"),
            "xff": self.headers.get("X-Forwarded-For"),
            "proto": self.headers.get("X-Forwarded-Proto"),
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PYEOF
# Free the port first: a leftover listener would make the stub die and every
# proxy assertion would then fail for the wrong reason.
if command -v fuser >/dev/null 2>&1; then fuser -k "${NODE_PORT}/tcp" >/dev/null 2>&1; sleep 1; fi
python3 "${SCRATCH}/stub-node.py" "${NODE_PORT}" &
STUB_PID=$!
sleep 1
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:${NODE_PORT}/probe"; then
  pass "stub Node backend listening on 127.0.0.1:${NODE_PORT}"
else
  fail "stub Node backend did not start on 127.0.0.1:${NODE_PORT}"
fi

# ------------------------------------------------------------------ config ---
mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled /var/log/nginx
rm -f /etc/nginx/sites-enabled/default
cp "${NGINX_DIR}/snippets/"*.conf /etc/nginx/snippets/
for vhost in cloudhost247-whmcs.conf cloudhost247-node.conf; do
  sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__APP_DOMAIN__|${APP_DOMAIN}|g" \
      -e "s|__WHMCS_ROOT__|${WEBROOT}|g" \
    "${NGINX_DIR}/${vhost}" > "/etc/nginx/sites-enabled/${vhost}"
  # An unrendered placeholder would make `nginx -t` pass while serving the wrong
  # root — assert the rendering instead of trusting it.
  if grep -q '__[A-Z_]*__' "/etc/nginx/sites-enabled/${vhost}"; then
    fail "unrendered placeholder left in ${vhost}: $(grep -o '__[A-Z_]*__' "/etc/nginx/sites-enabled/${vhost}" | sort -u | tr '\n' ' ')"
  fi
done
[ -f /etc/nginx/mime.types ] || printf 'types { text/html html; text/css css; application/json json; text/xml xml; }\n' > /etc/nginx/mime.types
# Distributions ship these two includes in the nginx package; a bare container
# does not. They are the standard contents, not CloudHost247 config.
[ -f /etc/nginx/fastcgi_params ] || cat > /etc/nginx/fastcgi_params <<'EOF'
fastcgi_param  QUERY_STRING       $query_string;
fastcgi_param  REQUEST_METHOD     $request_method;
fastcgi_param  CONTENT_TYPE       $content_type;
fastcgi_param  CONTENT_LENGTH     $content_length;
fastcgi_param  SCRIPT_NAME        $fastcgi_script_name;
fastcgi_param  REQUEST_URI        $request_uri;
fastcgi_param  DOCUMENT_URI       $document_uri;
fastcgi_param  DOCUMENT_ROOT      $document_root;
fastcgi_param  SERVER_PROTOCOL    $server_protocol;
fastcgi_param  REQUEST_SCHEME     $scheme;
fastcgi_param  HTTPS              $https if_not_empty;
fastcgi_param  GATEWAY_INTERFACE  CGI/1.1;
fastcgi_param  SERVER_SOFTWARE    nginx/$nginx_version;
fastcgi_param  REMOTE_ADDR        $remote_addr;
fastcgi_param  REMOTE_PORT        $remote_port;
fastcgi_param  SERVER_ADDR        $server_addr;
fastcgi_param  SERVER_PORT        $server_port;
fastcgi_param  SERVER_NAME        $server_name;
fastcgi_param  REDIRECT_STATUS    200;
EOF
# -p /etc/nginx matters: `include fastcgi_params;` in the vhost is a RELATIVE
# include, resolved against the nginx prefix. Ubuntu's packaged nginx runs with
# prefix /etc/nginx, so that is what this test must reproduce.
cat > "${SCRATCH}/nginx.conf" <<EOF
worker_processes 1;
error_log /var/log/nginx/error.log warn;
pid ${SCRATCH}/nginx.pid;
events { worker_connections 256; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/access.log;
    client_body_temp_path ${SCRATCH}/body;
    proxy_temp_path ${SCRATCH}/proxy;
    fastcgi_temp_path ${SCRATCH}/fastcgi;
    include /etc/nginx/sites-enabled/*.conf;
}
EOF
NGINX_PIDFILE="${SCRATCH}/nginx.pid"

echo
echo "[nginx -t]"
if out="$("$NGINX_BIN" -t -p /etc/nginx -c "${SCRATCH}/nginx.conf" 2>&1)"; then
  pass "configuration test succeeds"
else
  fail "nginx -t failed:"
  printf '%s\n' "${out}" | sed 's/^/      /'
fi
# Anything other than the expected no-OCSP-responder warning is a real problem.
if grep -qiE '\[emerg\]|\[alert\]|duplicate|is duplicate' <<<"${out}"; then
  fail "nginx -t emitted emerg/alert/duplicate warnings:"
  printf '%s\n' "${out}" | grep -iE '\[emerg\]|\[alert\]|duplicate' | sed 's/^/      /'
else
  pass "no emerg/alert/duplicate diagnostics"
fi

echo
echo "[start nginx]"
if "$NGINX_BIN" -p /etc/nginx -c "${SCRATCH}/nginx.conf" 2>/dev/null; then sleep 1; pass "nginx started"; else fail "nginx failed to start"; fi

# ----------------------------------------------------------------- probes ---
# HTTP status for a path on the WHMCS vhost.
code() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 5 \
    --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}$1" 2>/dev/null || echo 000
}
appcode() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 5 \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" "https://${APP_DOMAIN}$1" 2>/dev/null || echo 000
}
body() { curl -sk --max-time 5 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}$1" 2>/dev/null; }
headers() { curl -sk -D - -o /dev/null --max-time 5 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}$1" 2>/dev/null; }

echo
echo "[security denies — secrets must never be served]"
for p in /.env /configuration.php /templates_c/compiled.php /attachments/invoice.pdf /.git/config; do
  c="$(code "$p")"
  [[ "$c" == "403" || "$c" == "404" ]] && pass "${p} -> ${c}" || fail "${p} -> ${c} (expected 403/404)"
done

echo
echo "[source disclosure — PHP must never be served as text]"
# The regression this catches: a `^~ /tools/` prefix outranks the `\.php$`
# location, so nginx serves tools/index.php as a static file (HTTP 200 body
# containing "<?php"). Verified to happen with ^~ against nginx 1.24.0.
for p in /index.php /tools/ /tools/calculator /tools/index.php; do
  b="$(body "$p")"
  if grep -q '<?php' <<<"$b"; then
    fail "${p} returns raw PHP source (source disclosure)"
  else
    pass "${p} does not leak PHP source"
  fi
done

echo
echo "[ACME challenge over plain HTTP — required for Certbot]"
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: ${DOMAIN}" http://127.0.0.1/.well-known/acme-challenge/token 2>/dev/null)"
[[ "$c" == "200" ]] && pass "/.well-known/acme-challenge/ allowed (200)" || fail "ACME challenge -> ${c} (issuance would fail)"
t="$(curl -s --max-time 5 -H "Host: ${DOMAIN}" http://127.0.0.1/.well-known/acme-challenge/token 2>/dev/null)"
[[ "$t" == "acme-token-value" ]] && pass "challenge body served from /var/www/letsencrypt" || fail "challenge body was '${t}'"

echo
echo "[HTTP -> HTTPS redirect keeps path and query]"
r="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 5 -H "Host: ${DOMAIN}" "http://127.0.0.1/pricing?a=1" 2>/dev/null)"
[[ "$r" == "301 https://${DOMAIN}/pricing?a=1" ]] && pass "301 -> ${r}" || fail "redirect was '${r}'"

echo
echo "[pretty URLs and /tools/ front controller reach the right script]"
# PHP-FPM is absent here, so FastCGI yields 502; that still proves nginx
# resolved a .php location (a static fallthrough would be 200/404 instead).
for p in /pricing /some/deep/route /tools/ /tools/calculator; do
  c="$(code "$p")"
  [[ "$c" == "502" ]] && pass "${p} -> 502 (routed to PHP-FPM)" || fail "${p} -> ${c} (expected 502; PHP not reachable means routing fell through)"
done
if tail -50 /var/log/nginx/error.log 2>/dev/null | grep -qi 'redirection cycle'; then
  fail "rewrite/internal redirection cycle detected in nginx error log"
else
  pass "no rewrite or internal redirection cycles"
fi

echo
echo "[static assets and XML are served]"
for p in /assets/site.css /sitemap.xml; do
  c="$(code "$p")"; [[ "$c" == "200" ]] && pass "${p} -> 200" || fail "${p} -> ${c}"
done

echo
echo "[security headers survive the nested add_header locations]"
# Nginx drops inherited add_header when a location declares its own. Both the
# page location and the static-asset location must still carry these.
for h in strict-transport-security x-content-type-options x-frame-options referrer-policy permissions-policy content-security-policy; do
  if headers /pricing | grep -qi "^${h}:"; then pass "page: ${h}"; else fail "page: ${h} missing"; fi
done
for h in strict-transport-security x-content-type-options content-security-policy; do
  if headers /assets/site.css | grep -qi "^${h}:"; then pass "asset: ${h} (re-included)"; else fail "asset: ${h} dropped"; fi
done

echo
echo "[exactly one Cache-Control on a static asset]"
n="$(headers /assets/site.css | grep -ci '^cache-control:')"
[[ "$n" == "1" ]] && pass "1 Cache-Control header" || fail "${n} Cache-Control headers (duplicate bug)"

echo
echo "[Cache-Control on the API health endpoints]"
for p in /health /ready; do
  if curl -sk -D - -o /dev/null --max-time 5 --resolve "${APP_DOMAIN}:443:127.0.0.1" "https://${APP_DOMAIN}${p}" 2>/dev/null | grep -qi 'cache-control: no-store'; then
    pass "${p} -> Cache-Control: no-store"
  else
    fail "${p} not marked no-store"
  fi
done

echo
echo "[Node reverse proxy]"
j="$(curl -sk --max-time 5 --resolve "${APP_DOMAIN}:443:127.0.0.1" -H 'X-Forwarded-For: 203.0.113.9' "https://${APP_DOMAIN}/api/probe" 2>/dev/null)"
grep -q '"path": "/api/probe"' <<<"$j" && pass "path forwarded unchanged" || fail "path mangled: ${j}"
grep -q "\"host\": \"${APP_DOMAIN}\"" <<<"$j" && pass "Host header preserved" || fail "Host header wrong: ${j}"
grep -q '"proto": "https"' <<<"$j" && pass "X-Forwarded-Proto=https" || fail "X-Forwarded-Proto wrong (trustProxy needs this): ${j}"
grep -q '203.0.113.9' <<<"$j" && pass "X-Forwarded-For preserves the client IP" || fail "client IP lost: ${j}"

echo
echo "[HTTP/2 and TLS]"
v="$(curl -sk -o /dev/null -w '%{http_version}' --max-time 5 --resolve "${APP_DOMAIN}:443:127.0.0.1" "https://${APP_DOMAIN}/health" 2>/dev/null)"
[[ "$v" == "2" ]] && pass "HTTP/2 negotiated" || fail "HTTP version ${v} (expected 2)"
if curl -sk --max-time 5 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/pricing" >/dev/null 2>&1; then
  pass "TLS handshake succeeds on the WHMCS vhost"
else
  fail "TLS handshake failed"
fi

echo
echo "----------------------------------------"
printf 'passed: %d   failed: %d\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]] || { echo "NGINX LIVE TEST FAILED"; exit 1; }
echo "NGINX LIVE TEST PASSED"
