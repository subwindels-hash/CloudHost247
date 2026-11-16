# CloudHost247 — Ubuntu 24.04 VPS deployment (WHMCS 8.x + Node platform)

This is the **only** supported deployment target for CloudHost247: a dedicated
**Ubuntu 24.04 LTS** VPS running root-owned native services. Shared hosting,
control-panel "Application Manager" runtimes and Apache module process managers
are not supported and no longer have any configuration in this repository.

| Layer | Technology on the VPS |
|---|---|
| Web server / TLS edge | **Nginx 1.24** + Certbot (Let's Encrypt, webroot plugin) |
| WHMCS 8.x (PHP) | **PHP 8.2-FPM** (ondrej/php PPA) + ionCube Loader |
| WHMCS database | **MySQL 8.0** (Ubuntu default, localhost-only) |
| Node platform (`cloudhost247-node/`) | **Node.js 22 LTS** (NodeSource) under **systemd** |
| Node database | **PostgreSQL 16** (Ubuntu default, localhost-only) |
| Process supervision | **systemd** (`cloudhost247-node`, `cloudhost247-worker`) |
| Firewall / IDS | **UFW** + **fail2ban** |
| Cron | system **cron** (WHMCS + worker safety net + backups + healthcheck) |
| Private module storage | `/var/lib/cloudhost247` (0700 `www-data`, outside the web root) |

WHMCS core (`init.php`, `includes/`, `vendor/`, licence, `configuration.php`) is
commercial software and is **not** in this repository. The VPS scripts below install
it from the vendor ZIP you download from whmcs.com, then overlay the CloudHost247
customizations from this repo. See `docs/VPS_DEPLOYMENT.md` for the full runbook.

## Layout

```
infrastructure/vps/
├── README.md                    ← this file
├── setup-ubuntu-24.04.sh        ← idempotent host provisioning (run once as root)
├── nginx/
│   ├── cloudhost247-whmcs.conf  ← WHMCS vhost (PHP-FPM, pretty URLs, security)
│   ├── cloudhost247-node.conf   ← Node platform vhost (reverse proxy to :3000)
│   └── snippets/
│       ├── security-headers.conf ← HSTS/nosniff/referrer/permissions (both vhosts)
│       └── csp-whmcs.conf        ← CSP for WHMCS only (the SPA sends its own)
├── php/
│   ├── www.conf                 ← PHP-FPM pool (www-data)
│   └── zz-cloudhost247.ini      ← WHMCS upload/memory/time limits
├── systemd/
│   ├── cloudhost247-node.service    ← Fastify API + SPA (node dist/src/server.js)
│   └── cloudhost247-worker.service  ← deployment worker (persistent)
├── tests/
│   ├── smoke-test.sh            ← offline validation of every artefact (run in CI)
│   ├── nginx-live-test.sh       ← real nginx: routing, denies, headers, HTTP/2
│   ├── gate-test.sh             ← proves the provisioning gate can reject a bad host
│   ├── tls-check-test.sh        ← healthcheck certificate classification
│   └── setup-dry-run.sh         ← runs the provisioning script with stubbed commands
├── scripts/
│   ├── install-whmcs.sh         ← WHMCS core + CloudHost247 overlay installer
│   ├── deploy.sh                ← git pull → build → migrate → restart (+ --rollback)
│   ├── backup.sh                ← MySQL + PostgreSQL + files (checksummed)
│   ├── restore.sh               ← verified restore (dry-run by default)
│   └── healthcheck.sh           ← /health, /ready, WHMCS, PHP-FPM, DB, TLS probes
├── cron/cloudhost247.cron       ← WHMCS cron + worker fallback + backup + health + certbot
├── logrotate/cloudhost247       ← Nginx / PHP-FPM / Node log rotation
└── fail2ban/jail.local          ← SSH + Nginx auth hardening
```

## Quick start (fresh Ubuntu 24.04 VPS)

```bash
# 1. As root on the VPS:
git clone <repo-url> /opt/cloudhost247-src
cd /opt/cloudhost247-src
bash infrastructure/vps/setup-ubuntu-24.04.sh

# (the script is idempotent and bootstraps self-signed certs so `nginx -t` is
#  green before Certbot runs; Certbot replaces them in step 4.)

# 2. Download the WHMCS ZIP from whmcs.com → /root/whmcs.zip, then:
bash infrastructure/vps/scripts/install-whmcs.sh /root/whmcs.zip

# 3. Create /opt/cloudhost247/.env (see docs/VPS_DEPLOYMENT.md §6), then:
bash infrastructure/vps/scripts/deploy.sh

# 4. Issue certificates (after DNS points at the VPS):
certbot certonly --webroot -w /var/www/letsencrypt \
  -d cloudhost247.com -d www.cloudhost247.com -d app.cloudhost247.com
systemctl reload nginx

# 5. Verify:
bash infrastructure/vps/scripts/healthcheck.sh
```

Full step-by-step instructions, environment variables, WHMCS activation order,
cron, backups, updates, and rollback: **`docs/VPS_DEPLOYMENT.md`**.

## Why PHP 8.2 (not Ubuntu's default 8.3)?

WHMCS 8.x supports **PHP 7.4–8.2** (`README.md` → Runtime requirements).
Ubuntu 24.04 ships PHP 8.3 by default, which WHMCS 8.x does not support.
`setup-ubuntu-24.04.sh` therefore installs **PHP 8.2 from the ondrej/php PPA**
and pins it as the default. Do not switch the FPM pool to 8.3.

## Why Node 22 (not Ubuntu's default 18)?

The application requires **Node ≥ 20.9** (`cloudhost247-node/package.json`
`engines.node`; Fastify v5 dropped Node 18), and Ubuntu 24.04 ships Node 18.
The setup script therefore installs **Node.js 22 LTS from NodeSource**.

Why 22 and not 24: 22 is what the platform's CI matrix and lockfile are proven
against (`node-platform.yml` tests 22.12.0 and 24.8.0), and 22 is still an LTS
line. Node 24 also works for the app, but 22 is the conservative default for a
production host — raise `NODE_MAJOR` in the setup script if you need 24. Pin the
**exact** version in the app's `engines`/`.nvmrc` rather than trusting "22".

## Validating this stack before you run it

Three offline harnesses run in CI (`.github/workflows/vps-stack.yml`):

| Harness | Proves | Assertions |
|---|---|---|
| `tests/nginx-live-test.sh` | against a **running** nginx 1.24: secret denies, no PHP source disclosure, ACME reachable over HTTP, redirect keeps path+query, pretty-URL and `/tools/` routing, one `Cache-Control`, header inheritance, `X-Forwarded-*`, HTTP/2 | 43 |
| `tests/deploy-migrate-test.sh` | a deploy actually **lands**: the migration runner refuses on a fresh production DB (quarantined 0041), the documented override applies all 104 migrations into 264 tables, a re-run is a no-op, `deploy.sh` diagnoses the refusal correctly, and the systemd entrypoint `node dist/src/server.js` boots over TCP, serves `/health`, 503s `/ready` without crashing, and exits on SIGTERM; and the build runs where `../../modules` resolves | 29 |
| `tests/smoke-test.sh` | every artefact exists/parses, PHP 8.2 not 8.3, proxy headers, systemd user+group, compiled entrypoint, every placeholder rendered, backup auth, docs links, the retired shared-hosting path stays retired | 93 |
| `tests/setup-dry-run.sh` | the provisioning script runs end to end with stubbed system commands and renders every template (incl. UFW ordering, ionCube fallback, `__WHMCS_ROOT__` rendering, out-of-webroot module storage + `open_basedir`, Nginx deny rules for `crons/`/`storage/`/`vendor/` and uploaded builder media, cron user rendering, `tools/` overlay without developer helpers) | 50 |
| `tests/gate-test.sh` | the provisioning gate **rejects** a host lacking ionCube, on PHP 8.3, or missing a required extension | 8 |
| `tests/tls-check-test.sh` | `healthcheck.sh` classifies valid / expiring / missing / bootstrap-self-signed certificates correctly | 5 |

`nginx-live-test.sh` needs root and is destructive to `/etc/nginx`, so it only
runs in a disposable container/runner — never on a live host.

`deploy-migrate-test.sh` needs `cloudhost247-node` built (`npm ci && npm run
build`); without it, it SKIPs loudly rather than passing vacuously. It uses
**PGlite** (PostgreSQL compiled to WASM) as the engine, so it proves the schema
and the runner, not `pg`'s TCP transport — a real PostgreSQL 16 instance is
still only exercised on a live host.

`setup-dry-run.sh` rewrites only the paths and `SRC_DIR` in a **copy** of the
script (nothing on the host is touched) and asserts the rendered output.

`bash infrastructure/vps/tests/smoke-test.sh` checks every artefact offline
(files present, scripts parse and are executable, PHP 8.2 socket not 8.3, Node
proxy headers, systemd user/group consistency, every `__PLACEHOLDER__` actually
rendered, backup auth mode, docs links) and runs in CI via
`.github/workflows/vps-stack.yml`, which also runs a real `nginx -t`.

```bash
# Shell syntax for every script (no root needed, no changes made):
for f in infrastructure/vps/setup-ubuntu-24.04.sh \
         infrastructure/vps/scripts/*.sh \
         cloudhost247-node/scripts/package-vps.sh; do bash -n "$f" && echo "OK $f"; done

# Nginx config (on a machine with Nginx; renders placeholders first):
sed -e 's|__DOMAIN__|example.com|g' -e 's|__APP_DOMAIN__|app.example.com|g' \
    -e 's|__WHMCS_ROOT__|/var/www/whmcs|g' \
  infrastructure/vps/nginx/cloudhost247-whmcs.conf > /etc/nginx/sites-enabled/test.conf
nginx -t
```

`nginx -t` requires the certificate paths referenced by the vhosts to exist —
that is exactly why `setup-ubuntu-24.04.sh` bootstraps self-signed certs before
issuing the Let's Encrypt ones.

## Deployment target vs. control panels we sell

These are two different things and are deliberately kept apart:

- **Deployment target (this directory).** CloudHost247 is deployed only on a
  dedicated Ubuntu 24.04 LTS VPS: Nginx + PHP-FPM + MySQL 8 + PostgreSQL 16 +
  systemd + UFW/fail2ban. There is no shared-hosting, Apache-module or
  control-panel-managed Node runtime in this repository. The Node server binds
  `0.0.0.0:$PORT` (default 3000) and sets `trustProxy: true`, so Nginx is the
  only trusted edge.
- **Control panels as a product.** Customers can still buy and be provisioned
  onto cPanel, Plesk, CyberPanel and DirectAdmin hosting: those are runtime
  adapters in `cloudhost247-node/src/control-panels/adapters/` and
  `cloudhost247-node/src/deployments/adapters/`, plus the `cpanel-hosting.php`
  marketing page and the `cpanel_smtp` mail provider. They describe where
  *customer workloads* run, never where CloudHost247 itself is installed, and
  they must not be removed as part of deployment cleanup.

For the end-to-end operator runbook (DNS, WHMCS install, `.env`, migrations,
TLS, backups, rollback) see `docs/VPS_DEPLOYMENT.md`.
