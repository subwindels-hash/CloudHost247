# CloudHost247 — Ubuntu 24.04 VPS Deployment Guide (WHMCS 8.x + Node platform)

**Target:** a plain Linux VPS running **Ubuntu 24.04 LTS (noble)** with root access.
This is the **only** supported deployment target. The cPanel/Passenger path was
retired on 2026-11-15 (see Appendix B).

| Layer | Choice |
|---|---|
| Web server / TLS | **Nginx 1.24** + Certbot |
| WHMCS PHP | **PHP 8.2-FPM** (ondrej/php PPA) + ionCube |
| WHMCS DB | **MySQL 8.0** |
| Node runtime | **Node.js 22 LTS** + **systemd** |
| Node DB | **PostgreSQL 16** |
| Firewall / IDS | **UFW** + **fail2ban** |

> **Status — what is verified, and what is not.**
>
> **Verified in automated tests** (`infrastructure/vps/tests/`, run in CI by
> `.github/workflows/vps-stack.yml`):
> - The shipped Nginx vhosts pass `nginx -t` **and** behave correctly against a
>   real nginx 1.24.0 (the Ubuntu 24.04 version): secret-file denies, no PHP
>   source disclosure, ACME challenge reachable over plain HTTP, HTTP→HTTPS
>   redirect preserving path and query, pretty-URL and `/tools/` front-controller
>   routing, exactly one `Cache-Control`, security headers surviving the nested
>   `add_header` locations, `X-Forwarded-*` to the Node app, HTTP/2 — 43 assertions.
> - The provisioning script runs end to end with stubbed system commands and
>   renders every template correctly (33 assertions).
> - Its final gate **rejects** a host without ionCube, on PHP 8.3, or missing a
>   required extension (8 assertions), so a green run cannot mean a WHMCS that
>   will not boot.
> - Backup/restore use Ubuntu-correct database auth; every placeholder is
>   rendered; no recursive copy can leak repo files into the webroot.
> - **A deploy actually lands.** The compiled Node app is built with the same
>   `npm ci && npm run build` that `deploy.sh` runs, the real migration runner is
>   executed against a real database, and the systemd entrypoint
>   (`node dist/src/server.js`) is booted over TCP and probed — 28 assertions.
>   This found and closed three genuine deploy blockers:
>   1. `deploy.sh` applied **no migrations at all** on a fresh database, because
>      quarantined migration `0041` has pending dependents and the runner fails
>      closed. The schema stayed empty — see "First deploy: the quarantine gate"
>      in §6. `deploy.sh` now diagnoses this instead of reporting "migration
>      failed", and forwards `AUTHORIZED_MIGRATIONS`.
>   2. The systemd unit started `./server.js` — the cPanel Passenger bootstrap —
>      instead of the compiled app. Under systemd that bootstrap binds a port,
>      then compiles TypeScript and Vite in-process before the app exists:
>      machinery that only makes sense under Passenger's startup timeout, and a
>      way to end up serving a build that never ran `npm ci`. The unit now runs
>      `node dist/src/server.js` behind an `ExecStartPre` guard, and the
>      bootstrap itself has been deleted (Appendix B).
>   3. **`npm run build` could not succeed on a VPS at all.** The build writes
>      `modules/addons/cloudhost247_theme/resources/tools.json` and
>      `assets/cloudhost247-tools/`, both at `../../` — repo-root paths.
>      `deploy.sh` built inside `/opt/cloudhost247`, which contains only
>      `cloudhost247-node/`, so the pre-build `tools:catalog:check` step died
>      with "Tools projection is stale" and `dist/` was never produced. (Adding
>      `public/` to the rsync excludes made this deterministic: the check fails
>      whatever state `public/` was in.) `deploy.sh` now builds in the checkout
>      and publishes `dist/` + `public/`; the projection script now says where
>      the build must run instead of reporting a stale projection.
> - `/ready` now verifies the **schema**, not just the connection. It previously
>   ran `SELECT 1`, which succeeds against a completely empty database, so a
>   deploy that skipped migrations reported ready while every real query failed.
>
> **NOT verified:** none of this has run on a real Ubuntu 24.04 VPS with a
> licensed WHMCS. No `apt-get` install, `systemd` start, MySQL/PostgreSQL
> creation, Certbot issuance, or WHMCS installer run has been executed.
> The database engine in the automated tests is PGlite (PostgreSQL compiled to
> WASM), so the schema and the migration runner are covered but `pg`'s real TCP
> transport to PostgreSQL 16 is not. The systemd unit was exercised by running
> its exact `ExecStart` command line directly — **not** via `systemctl start` — so
> unit semantics (`ProtectSystem`, `ReadWritePaths`, `EnvironmentFile`) are
> unproven. The ionCube download host was unreachable from the verification
> environment, so
> that URL is unconfirmed (the script now has an offline fallback). **Complete
> Appendix C on your real VPS before calling this production-ready.** WHMCS core
> is commercial software and is **not** in this repo; download it from whmcs.com.

---

## 0. Architecture

```
Internet
   │
   ▼
Nginx (80/443, TLS via Let's Encrypt)
   ├── https://cloudhost247.com ──► /var/www/whmcs ──► PHP 8.2-FPM ──► MySQL 8.0
   │                                   (WHMCS 8.x + CloudHost247 overlay)
   │
   └── https://app.cloudhost247.com ──► 127.0.0.1:3000 (systemd: cloudhost247-node)
                                          (Fastify API + SPA) ──► PostgreSQL 16
                                          (systemd: cloudhost247-worker)
```

- **WHMCS** (`/var/www/whmcs`) is the public site, client area, cart, and
  billing system. The CloudHost247 overlay (`templates/`, `modules/`, `crons/`,
  `lang/`, `config/`, root `*.php`) is copied over a stock WHMCS install.
- **Node platform** (`/opt/cloudhost247`) is the independent control plane
  (API + portal + deployment worker). It is a **separate application** with its
  own PostgreSQL database and `.env` — never copy it into the WHMCS root.
- **Nginx** is the TLS edge and reverse proxy for both. The Node app binds
  `0.0.0.0:$PORT` (default 3000) with `trustProxy: true`, so it expects to sit
  behind the Nginx vhost shipped in `infrastructure/vps/nginx/`.

### Why PHP 8.2 and Node 22?

- **WHMCS 8.x requires PHP 7.4–8.2** (`README.md` → Runtime requirements).
  Ubuntu 24.04 ships **PHP 8.3** by default, which WHMCS 8.x does **not**
  support. The setup script installs **PHP 8.2 from the ondrej/php PPA** and
  pins it. Never switch the FPM pool to 8.3.
- **The Node platform requires Node ≥ 20.9** (`cloudhost247-node/package.json`
  `engines.node`; Fastify v5 dropped Node 18). Ubuntu 24.04 ships **Node 18**.
  The setup script installs **Node.js 22 LTS from NodeSource** — 22 is what CI
  proves the platform against (`node-platform.yml` runs 22.12.0 and 24.8.0).
  Node 24 is also supported by the app; export `NODE_MAJOR=24` to use it.

---

## 1. Prerequisites (verify before you start)

1. **VPS:** Ubuntu 24.04 LTS (noble), 2 vCPU / 4 GB RAM minimum (4 vCPU / 8 GB
   recommended), root SSH access, public IP.
2. **DNS:** `cloudhost247.com` and `app.cloudhost247.com` pointing at the VPS IP
   (A records; TTL 300 during setup).
3. **WHMCS licence:** a valid WHMCS 8.x licence. Download the WHMCS ZIP from
   whmcs.com → your licensed account → Downloads. You will pass its path to
   `install-whmcs.sh`.
4. **SSH key:** your public key installed for root (password auth will be
   disabled in §3).
5. **Email:** SMTP credentials for WHMCS + Node (password-reset, verification,
   transactional mail). See `EMAIL-DELIVERY-CERTIFICATION.md`.

---

## 2. Provision the host (one command)

```bash
# As root on the fresh VPS:
git clone <repo-url> /opt/cloudhost247-src
cd /opt/cloudhost247-src
sudo bash infrastructure/vps/setup-ubuntu-24.04.sh
```

The script is **idempotent** — safe to re-run. It installs and configures:

- Base hardening: UFW (22/80/443), fail2ban, unattended-upgrades, 2 GiB swap
- Nginx 1.24 + Certbot
- PHP 8.2-FPM (ondrej/php PPA) + ionCube Loader + WHMCS extensions
  (`curl`, `json`, `openssl`, `pdo_mysql`, `mbstring`, `dom`, `fileinfo`,
  `filter`, `gd`, `imap`, `soap`, `xml`, `zip`, `intl`, `bcmath`, …)
- MySQL 8.0 (utf8mb4, InnoDB, localhost-only) + PostgreSQL 16 (localhost-only)
- Node.js 22 LTS (NodeSource)
- App user `cloudhost247`, directories, Nginx vhosts, PHP-FPM pool,
  systemd units, logrotate, fail2ban jail, cron snippet

Verify the install:

```bash
php -v | head -n 1          # must say PHP 8.2.x
php -m | grep -i ioncube    # must list ionCube Loader
node --version              # must be v22.x
nginx -t                    # must say syntax ok
```

---

## 3. Harden SSH (after confirming key login works)

```bash
# /etc/ssh/sshd_config — key-only, no root password, no X11
PasswordAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
sudo systemctl restart ssh
```

fail2ban (installed in §2) bans brute-force attempts against SSH and the
WHMCS admin login. UFW already allows only 22/80/443.

---

## 4. Create databases and users

```bash
# WHMCS (MySQL)
mysql -u root -p
CREATE DATABASE whmcs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'whmcs'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT ALL PRIVILEGES ON whmcs.* TO 'whmcs'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# Node platform (PostgreSQL)
sudo -u postgres psql
CREATE USER cloudhost247 WITH PASSWORD '<strong-password>';
CREATE DATABASE cloudhost247 OWNER cloudhost247;
\q
```

Record these passwords — they go into `configuration.php` (WHMCS installer)
and `/opt/cloudhost247/.env` (`DATABASE_URL`) respectively. Never commit them.

---

## 5. Install WHMCS + CloudHost247 overlay

```bash
# Download the WHMCS ZIP from whmcs.com → /root/whmcs.zip, then (from the
# checkout at /opt/cloudhost247-src created in §2):
cd /opt/cloudhost247-src
sudo bash infrastructure/vps/scripts/install-whmcs.sh /root/whmcs.zip
```

This extracts WHMCS core into `/var/www/whmcs` (preserving any existing
`configuration.php`), overlays the CloudHost247 customizations
(`templates/`, `modules/`, `crons/`, `lang/`, `config/`, root `*.php`,
`assets/`, `errors/`), and fixes ownership (`www-data`) and permissions
(`templates_c`, `attachments`, `downloads` → 775).

The overlay **merge-copies without `--delete`**: `templates/`, `modules/` and
`crons/` contain stock WHMCS files this repository does not ship
(`templates/orderforms/standard_cart/`, `crons/cron.php`, vendor modules) and
deleting them would break the order forms and WHMCS automation. The installer
asserts afterwards that `crons/cron.php` and `standard_cart` are still there.
Obsolete files from an older release are removed from a reviewed list, never by
blanket deletion.

Then:

1. Point DNS (§1) and issue certificates:
   ```bash
   sudo certbot certonly --webroot -w /var/www/letsencrypt \
     -d cloudhost247.com -d www.cloudhost247.com
   sudo systemctl reload nginx
   ```
2. Open `https://cloudhost247.com/install/` and complete the WHMCS web
   installer (database credentials from §4).
3. Delete the installer: `sudo rm -rf /var/www/whmcs/install`
4. Set the WHMCS `SystemURL` to `https://cloudhost247.com` (Admin → System
   Settings → General Settings).

---

## 6. Deploy the Node platform

```bash
# Create /opt/cloudhost247/.env (deploy.sh refuses to run without it).
sudo mkdir -p /opt/cloudhost247
sudo cp /opt/cloudhost247-src/cloudhost247-node/.env.example /opt/cloudhost247/.env
sudo nano /opt/cloudhost247/.env
sudo chown cloudhost247:cloudhost247 /opt/cloudhost247/.env
sudo chmod 600 /opt/cloudhost247/.env
```

Key variables (see `cloudhost247-node/.env.example` for the full list):

```ini
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
APP_URL=https://app.cloudhost247.com
DATABASE_URL=postgresql://cloudhost247:<password>@127.0.0.1:5432/cloudhost247
DATABASE_SSL=false
JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
CREDENTIAL_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

`PORT=3000` is set explicitly by the systemd unit (`Environment=PORT=3000`), and
Nginx proxies `127.0.0.1:3000`. `DATABASE_SSL=false` is correct for localhost
PostgreSQL.

Then deploy. **On a fresh database the first run needs one extra variable** — see
"First deploy: the quarantine gate" below:

```bash
cd /opt/cloudhost247-src
sudo AUTHORIZED_MIGRATIONS=0041 bash infrastructure/vps/scripts/deploy.sh
```

This syncs `cloudhost247-node/` → `/opt/cloudhost247`, **builds in the git
checkout**, installs runtime-only dependencies into `/opt/cloudhost247`,
publishes `dist/` + `public/`, applies migrations with `CONFIRM_MIGRATION=yes`,
verifies checksums, restarts `cloudhost247-node` + `cloudhost247-worker`, reloads
Nginx, and runs the healthcheck.

> **Why the build happens in the checkout and not in `/opt/cloudhost247`.**
> `cloudhost247-node`'s build writes two things **outside** its own directory:
> `modules/addons/cloudhost247_theme/resources/tools.json` (via
> `tools:catalog:check`/`tools:catalog`) and `assets/cloudhost247-tools/` (the
> tools bundle). Both are resolved as `../../…` — i.e. paths relative to the
> **repository root**. `/opt/cloudhost247` holds only `cloudhost247-node/`, so
> `../../modules` becomes `/opt/modules`. `npm run build` runs
> `tools:catalog:check` *before* `build:server`, so building there dies before
> emitting a single byte of `dist/`. Building in the checkout also means the
> devDependencies (`tsc`, `vite`, `tsx`) are discarded instead of shipped.

### First deploy: the quarantine gate

Migration `0041` is **quarantined** by a standing restriction in
`docs/NODE_PLATFORM_STATUS.md` ("prepared and tested only, NOT authorized for
production execution"). The migration runner enforces that restriction rather
than trusting the documentation: a production run skips quarantined artifacts,
and if a *pending* migration depends on one it refuses the **entire** run
before executing any DDL, so a production schema is never left half-upgraded.

On a fresh database `0041` and its ten dependents (`0042`, `0043`, `0047`,
`0048`, `0049`, `0051`, `0052`, `0054`, `0056`, `0059`) are all pending, so the
first production migration would apply **nothing** and exit non-zero. The
application would then start against an empty schema. `deploy.sh` detects that
refusal specifically and stops with:

```
Migrations are blocked by a standing quarantine, not by a SQL error.
  The pending quarantine rule(s) affect: 0041
```

To proceed you must authorize the quarantined artifact explicitly, for that run
only:

```bash
sudo AUTHORIZED_MIGRATIONS=0041 bash infrastructure/vps/scripts/deploy.sh
```

Authorization is per-run and never persisted — a later `deploy.sh` without the
variable asks again. Removing the quarantine itself is a **compliance decision,
not a deployment step**: it means editing `QUARANTINED_MIGRATIONS` in
`cloudhost247-node/database/migrate.ts` and documenting that the artifacts are
authorized. Do not do that merely to make a deploy go green.

Verify afterwards:

```bash
sudo -u cloudhost247 bash -c 'cd /opt/cloudhost247 && npm run migrate:status'
curl -fsS localhost:3000/ready
```

`/ready` returns 200 only when the database is reachable *and* the migration
ledger (`schema_migrations`) exists. A host that answers `/health` but returns
503 from `/ready` with `{"checks":{"database":"ok","schema":"missing"}}` has a
database that was never migrated — which is exactly what the quarantine gate
above produces if it is ignored.

Issue the Node certificate:

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt -d app.cloudhost247.com
sudo systemctl reload nginx
```

---

## 7. Activate WHMCS modules

**The activation order is defined once, in
[`docs/INSTALLATION-GUIDE.md`](INSTALLATION-GUIDE.md) §4.2** — follow it there
rather than duplicating it here, because it also covers retiring modules this
package no longer ships (§4.1: SMM prototype, the earlier email build, leftover
demo routes). That step is an **upgrade-only** procedure; on a fresh VPS install
there is nothing to retire.

The VPS-specific points are:

1. The overlay in §5 already placed `modules/`, `templates/`, `lang/`,
   `config/` and `crons/` under `/var/www/whmcs`. Verify with
   `ls /var/www/whmcs/modules/addons` before activating anything.
2. Run the migration validator from the checkout (it validates source
   migrations; it does **not** apply them):

   ```bash
   sudo python3 /opt/cloudhost247-src/scripts/validate-migrations.py --json-output /root/migrations.json
   ```

   Module activation applies its own migrations through the WHMCS UI — never
   hand-run ad-hoc SQL.
3. `tools_center` ships an `external-api/` backend that must be deployed
   **outside** the WHMCS webroot (its own vhost or a systemd service), per its
   `INSTALL.md`. On the VPS that means a separate Nginx server block, not a
   directory under `/var/www/whmcs`.
4. `xtreme_currency_rates` (and the retired theme-helper addon) are
   ionCube-encoded — they only load because §2 installed the Loader. Confirm
   with `php -m | grep ionCube` before activating them, or WHMCS will show a
   blank page.
5. **Never activate RDP** — see the table in `INSTALLATION-GUIDE.md` §4.2.

Then configure payment gateways (Stripe/PayPal/Paystack/Blockonomics), email
templates and product server bindings per
[`docs/INSTALLATION-GUIDE.md`](INSTALLATION-GUIDE.md) §5.

---

## 8. Cron, backups, and updates

**Cron** (installed to `/etc/cron.d/cloudhost247`):

| Schedule | Job |
|---|---|
| Every 5 min | WHMCS `crons/cron.php` (invoicing, provisioning, email) |
| Every minute | Node worker one-shot fallback (lease-guarded; the persistent systemd worker is primary) |
| Every 15 min | `healthcheck.sh` → `/var/log/cloudhost247/healthcheck.log` (exit 1 on failure) |
| Daily 02:30 | Host backup (`backup.sh`, 30-day retention) |
| Every 12 h | Certbot renewal + Nginx reload |

All commands below run from the checkout (`cd /opt/cloudhost247-src`).

**Backups:**

```bash
sudo bash infrastructure/vps/scripts/backup.sh          # create (checksummed)
sudo bash infrastructure/vps/scripts/restore.sh /var/backups/cloudhost247/<archive>.tar.gz  # dry-run
sudo bash infrastructure/vps/scripts/restore.sh /var/backups/cloudhost247/<archive>.tar.gz --confirm  # restore
```

MySQL is dumped as unix-socket `root` (Ubuntu's `auth_socket` plugin — no
password on disk) and PostgreSQL as the `postgres` OS user (Ubuntu's default
`peer` rule), so **run both scripts as root without `sudo -u`**. Restores are
dry-run unless you pass `--confirm`, and the archive checksum is verified first.

Backups contain the MySQL dump, PostgreSQL dump (`pg_dump -Fc`), WHMCS files,
and Node `.env` + manifests. Off-server upload for server-agent archives is
handled by the Node control plane (`BACKUP_S3_*` env → S3/R2/Wasabi/MinIO).

**Updates:**

```bash
sudo bash infrastructure/vps/scripts/deploy.sh   # Node: pull → build → migrate → restart
sudo bash infrastructure/vps/scripts/install-whmcs.sh /root/whmcs.zip  # WHMCS overlay (new release)
```

**Rollback:** every `deploy.sh` run snapshots the previous `dist/`, `public/` and
`package-lock.json` into `/opt/cloudhost247/.previous-build` **before** building.
If a deploy fails the build step, the snapshot is restored automatically and the
services are left untouched; if it passes the build but fails the healthcheck:

```bash
sudo bash infrastructure/vps/scripts/deploy.sh --rollback
```

That stops the services, restores the snapshot, restarts, and re-runs the
healthcheck. Database migrations are **not** reverted (they are forward-only) —
so take a backup before a deploy that ships migrations.

**Health:**

```bash
bash infrastructure/vps/scripts/healthcheck.sh
journalctl -u cloudhost247-node -f
journalctl -u cloudhost247-worker -f
```

---

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| WHMCS 500 / blank page | `journalctl -u php8.2-fpm -n 50`, `tail /var/log/nginx/cloudhost247-whmcs.error.log`, `php -m \| grep -i ioncube` |
| Node 502 (Nginx) | `systemctl status cloudhost247-node`, `journalctl -u cloudhost247-node -n 50`, `curl http://127.0.0.1:3000/health` |
| Node 503 `DATABASE_NOT_CONFIGURED` | `DATABASE_URL` in `/opt/cloudhost247/.env`, `pg_isready`, `sudo -u postgres psql -c '\l'` |
| WHMCS pretty URLs 404 | Nginx `try_files` in `cloudhost247-whmcs.conf`; `nginx -t && systemctl reload nginx` |
| PHP version wrong | `php -v` must be 8.2.x; `update-alternatives --set php /usr/bin/php8.2` |
| Certificate errors | `certbot certificates`, then `certbot certonly --webroot -w /var/www/letsencrypt -d <domain> && systemctl reload nginx` |

---

## Appendix A — File map

| VPS path | Source in repo |
|---|---|
| `/etc/nginx/sites-available/cloudhost247-whmcs.conf` | `infrastructure/vps/nginx/cloudhost247-whmcs.conf` |
| `/etc/nginx/sites-available/cloudhost247-node.conf` | `infrastructure/vps/nginx/cloudhost247-node.conf` |
| `/etc/nginx/snippets/security-headers.conf` | `infrastructure/vps/nginx/snippets/security-headers.conf` |
| `/etc/php/8.2/fpm/pool.d/www.conf` | `infrastructure/vps/php/www.conf` |
| `/etc/php/8.2/fpm/conf.d/zz-cloudhost247.ini` | `infrastructure/vps/php/zz-cloudhost247.ini` |
| `/etc/systemd/system/cloudhost247-node.service` | `infrastructure/vps/systemd/cloudhost247-node.service` |
| `/etc/systemd/system/cloudhost247-worker.service` | `infrastructure/vps/systemd/cloudhost247-worker.service` |
| `/etc/cron.d/cloudhost247` | `infrastructure/vps/cron/cloudhost247.cron` |
| `/etc/logrotate.d/cloudhost247` | `infrastructure/vps/logrotate/cloudhost247` |
| `/etc/fail2ban/jail.local` | `infrastructure/vps/fail2ban/jail.local` |
| `/var/www/whmcs` | WHMCS core + repo overlay (`install-whmcs.sh`) |
| `/opt/cloudhost247` | `cloudhost247-node/` (`deploy.sh`) |

## Appendix B — What this stack replaced

The cPanel/Passenger deployment path was **retired on 2026-11-15**. Removed:
`docs/CPANEL_DEPLOYMENT.md`, `cloudhost247-node/docs/CPANEL_DEPLOYMENT.md`,
`cloudhost247-node/scripts/package-cpanel.sh`,
`infrastructure/litespeed/webroot-hardening.htaccess`, and the 922-line
`cloudhost247-node/server.js` Passenger bootstrap (which bound a socket, then
compiled TypeScript in-process to survive Passenger's startup timeout).

The mapping for anyone migrating an existing cPanel install:

- **Passenger → systemd:** `cloudhost247-node.service` runs
  `node --max-old-space-size=512 dist/src/server.js` with `PORT=3000`, an
  `ExecStartPre` guard that fails the unit if `dist/` is missing, and
  `Restart=on-failure`. No Application Manager, no `PassengerAppRoot`/
  `PassengerNodejs` directives, no in-process build.
- **Apache `.htaccess` → Nginx:** WHMCS pretty URLs and `/tools/` rewrites are
  translated to `try_files` in the Nginx vhosts. `.htaccess` is inert under
  Nginx and no longer ships.
- **cPanel PHP Selector → PHP 8.2-FPM:** ondrej/php PPA + ionCube Loader.
- **cPanel Cron → system cron + systemd:** WHMCS cron every 5 min; Node worker
  as a persistent systemd service (plus a lease-guarded one-shot fallback).
- **cPanel AutoSSL → Certbot:** `certbot certonly --webroot -w /var/www/letsencrypt`
  for both domains, then `systemctl reload nginx`. The webroot plugin only
  writes certificate files; the hand-tuned vhosts are never rewritten.

> "cPanel hosting" still appears throughout the product catalogue, the pricing
> pages and `src/control-panels/adapters/`. That is the **product CloudHost247
> sells**, not the platform it runs on — it must not be removed.

## Appendix C — Go-live checklist (all must pass)

- [ ] `setup-ubuntu-24.04.sh` ran clean on Ubuntu 24.04 (noble)
- [ ] `php -v` = 8.2.x, ionCube loaded, `pdo_mysql` present
- [ ] `node --version` = v22.x, `nginx -t` clean
- [ ] DNS resolves for both domains; Certbot certificates valid (> 14 days)
- [ ] WHMCS installer completed; `install/` deleted; `SystemURL` = HTTPS
- [ ] `crons/cron.php` and `templates/orderforms/standard_cart/` still present after the overlay
- [ ] All §7 modules activated; payment gateways in test mode
- [ ] Node `/health` = 200; `/ready` = 200 **with `"schema":"ok"`** (a 503 here means
      migrations did not apply — see §6 "First deploy: the quarantine gate")
- [ ] `npm run migrate:status` reports no pending migrations; any `AUTHORIZED_MIGRATIONS`
      used on this host is recorded in the change log
- [ ] WHMCS `/` = 200/302
- [ ] `healthcheck.sh` = ALL CHECKS PASSED
- [ ] WHMCS cron running (check `whmcs-cron.log`); worker service active
- [ ] `backup.sh` created + `restore.sh` dry-run verified; restore tested on staging
- [ ] UFW + fail2ban active; SSH key-only
- [ ] Second reviewer signed off (see `DEPLOYMENT-CHECKLIST.md` gates CT-01..CT-08)
