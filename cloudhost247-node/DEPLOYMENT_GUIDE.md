# CloudHost247 Node Platform — Ubuntu 24.04 VPS Deployment Guide

This application (`cloudhost247-node/`) deploys exclusively to a **dedicated Ubuntu 24.04 LTS VPS** running **Nginx 1.24**, **Node.js 22 LTS**, **PostgreSQL 16**, and **systemd** (`cloudhost247-node.service` + `cloudhost247-worker.service`). Shared/cPanel/Passenger hosting is not supported.

For the complete host provisioning + WHMCS + Node runbook, start at [`../docs/VPS_DEPLOYMENT.md`](../docs/VPS_DEPLOYMENT.md).

---

## Architecture on the VPS

- **Source checkout:** `/opt/cloudhost247-src` (full repository checkout; `npm run build` executes here so cross-surface projections resolve `../../modules` and `../../assets`)
- **Runtime directory:** `/opt/cloudhost247` (owned by system user `cloudhost247:cloudhost247`; contains compiled `dist/`, built `public/`, `manifests/`, `config/`, `database/migrations/`, runtime `node_modules/`, and mode-`0600` `.env`)
- **API & SPA process:** `cloudhost247-node.service` (`node --max-old-space-size=512 dist/src/server.js`, bound to `0.0.0.0:3000`, proxied by Nginx from `127.0.0.1:3000`)
- **Deployment worker:** `cloudhost247-worker.service` (`node --max-old-space-size=512 dist/src/worker/main.js`, persistent systemd service with a lease-guarded 1-minute fallback in `/etc/cron.d/cloudhost247`)
- **Database:** PostgreSQL 16 (`127.0.0.1:5432` or external managed PostgreSQL with TLS)

---

## Standard VPS Deployment (`deploy.sh`)

1. **Provision Ubuntu 24.04 LTS once as root:**
   ```bash
   git clone <repo-url> /opt/cloudhost247-src
   cd /opt/cloudhost247-src
   sudo bash infrastructure/vps/setup-ubuntu-24.04.sh
   ```

2. **Create the PostgreSQL 16 user and database:**
   ```bash
   sudo -u postgres psql -c "CREATE USER cloudhost247 WITH PASSWORD '<strong-password>';"
   sudo -u postgres psql -c "CREATE DATABASE cloudhost247 OWNER cloudhost247;"
   ```

3. **Configure `/opt/cloudhost247/.env`:**
   ```bash
   sudo cp /opt/cloudhost247-src/cloudhost247-node/.env.example /opt/cloudhost247/.env
   sudo chown cloudhost247:cloudhost247 /opt/cloudhost247/.env
   sudo chmod 600 /opt/cloudhost247/.env
   sudo nano /opt/cloudhost247/.env
   ```
   Required settings:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `APP_URL=https://app.yourdomain.com`
   - `DATABASE_URL=postgresql://cloudhost247:<password>@127.0.0.1:5432/cloudhost247`
   - `DATABASE_SSL=false` (set `true` for external managed PostgreSQL)
   - `JWT_SECRET=<64+ random hex/base64url chars>`
   - `CREDENTIAL_ENCRYPTION_KEY=<64 hex chars (32 random bytes)>`

4. **Build, migrate, and start services:**
   On a fresh database, explicitly authorize quarantined migration `0041` after reviewing `../docs/VPS_DEPLOYMENT.md` §6:
   ```bash
   cd /opt/cloudhost247-src
   sudo AUTHORIZED_MIGRATIONS=0041 bash infrastructure/vps/scripts/deploy.sh
   ```
   On subsequent updates:
   ```bash
   cd /opt/cloudhost247-src
   sudo bash infrastructure/vps/scripts/deploy.sh
   ```

5. **Issue Let's Encrypt TLS certificate (webroot plugin):**
   ```bash
   sudo certbot certonly --webroot -w /var/www/letsencrypt -d app.yourdomain.com
   sudo systemctl reload nginx
   ```

6. **Verify health & readiness:**
   ```bash
   sudo bash /opt/cloudhost247-src/infrastructure/vps/scripts/healthcheck.sh
   curl -fsS https://app.yourdomain.com/health
   curl -fsS https://app.yourdomain.com/ready
   ```

---

## Pre-Built Release Archive (`package-vps.sh`)

If you build in CI or on a workstation instead of building on the VPS:

```bash
cd cloudhost247-node
bash scripts/package-vps.sh
# Produces: cloudhost247-node/release/cloudhost247-vps-<git-sha>.zip
```

Extract its contents into `/opt/cloudhost247`, run `sudo -u cloudhost247 bash -c 'cd /opt/cloudhost247 && npm ci --omit=dev'`, apply migrations (`CONFIRM_MIGRATION=yes npm run migrate`), and restart `cloudhost247-node` and `cloudhost247-worker`.

---

## Rollback & Backups

- **Instant code rollback:** `sudo bash infrastructure/vps/scripts/deploy.sh --rollback` restores `/opt/cloudhost247/.previous-build` and re-verifies health.
- **Checksummed host backup:** `sudo bash infrastructure/vps/scripts/backup.sh` archives MySQL, PostgreSQL (`pg_dump -Fc`), WHMCS files, `/var/lib/cloudhost247` module storage, and `/opt/cloudhost247` into `/var/backups/cloudhost247/`.
- **Verified restore:** `sudo bash infrastructure/vps/scripts/restore.sh /var/backups/cloudhost247/<archive>.tar.gz --confirm`.
