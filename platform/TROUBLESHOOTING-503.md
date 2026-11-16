# Troubleshooting 502 / 503 Errors on Ubuntu 24.04 VPS

> **Note:** `cloudhost247-node/` is the canonical production Node platform deployed to `/opt/cloudhost247` by `infrastructure/vps/scripts/deploy.sh` (see [`docs/VPS_DEPLOYMENT.md`](../docs/VPS_DEPLOYMENT.md)). This guide covers diagnosing Nginx / systemd upstream 502 and 503 errors on the VPS.

## Quick Diagnosis (Ubuntu 24.04 VPS)

Run these checks over SSH on the VPS in order:

### 1. Check systemd service status

```bash
sudo systemctl status cloudhost247-node cloudhost247-worker nginx postgresql
```

If `cloudhost247-node` is stopped or failed, restart it after checking logs:

```bash
sudo systemctl restart cloudhost247-node
```

### 2. Inspect systemd journal logs

```bash
sudo journalctl -u cloudhost247-node -n 100 --no-pager
sudo tail -n 50 /var/log/nginx/cloudhost247-node.error.log
```

### 3. Verify Node.js runtime version

```bash
node --version
# Canonical cloudhost247-node requires >= 20.9.0 (Node 22 LTS installed by setup-ubuntu-24.04.sh)
# Legacy platform/ requires >= 22.20.0 < 25
```

### 4. Verify `/opt/cloudhost247/.env`

Ensure `/opt/cloudhost247/.env` exists (`chmod 600`, owned by `cloudhost247:cloudhost247`) and sets:

- `NODE_ENV=production`
- `PORT=3000`
- `APP_URL=https://app.your-domain.com`
- `DATABASE_URL=postgresql://cloudhost247:<password>@127.0.0.1:5432/cloudhost247`
- `DATABASE_SSL=false` (for localhost PostgreSQL 16 on the VPS)
- `JWT_SECRET=<64+ character random secret>`
- `CREDENTIAL_ENCRYPTION_KEY=<64-hex random key>`

### 5. Run the automated VPS healthcheck

```bash
sudo bash /opt/cloudhost247-src/infrastructure/vps/scripts/healthcheck.sh
```

## Common Causes and Fixes

### Cause 1: Missing or Malformed Environment Variables

If `JWT_SECRET` or `DATABASE_URL` is malformed in `/opt/cloudhost247/.env`, edit `/opt/cloudhost247/.env` and restart systemd:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
sudo nano /opt/cloudhost247/.env
sudo systemctl restart cloudhost247-node cloudhost247-worker
```

### Cause 2: Build Output (`dist/`) Missing

`cloudhost247-node.service` enforces `ExecStartPre=/usr/bin/test -f /opt/cloudhost247/dist/src/server.js`. Run the VPS deployment script from the git checkout:

```bash
cd /opt/cloudhost247-src
sudo bash infrastructure/vps/scripts/deploy.sh
```

### Cause 3: Pending or Quarantined Database Migrations (`/ready` returns 503)

If `GET /health` returns `200` while `GET /ready` returns `503 {"checks":{"database":"ok","schema":"missing"}}`, migrations have not been applied yet. On a fresh database, explicitly authorize quarantined migration `0041` after reviewing `docs/VPS_DEPLOYMENT.md` §6:

```bash
cd /opt/cloudhost247-src
sudo AUTHORIZED_MIGRATIONS=0041 bash infrastructure/vps/scripts/deploy.sh
```

### Cause 4: Port 3000 Conflict or Upstream Down (Nginx 502 Bad Gateway)

Verify the process is listening on `0.0.0.0:3000` (or `127.0.0.1:3000`):

```bash
ss -tlnp | grep ':3000'
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

For full VPS provisioning, updates, backups, and rollback (`deploy.sh --rollback`), see [`docs/VPS_DEPLOYMENT.md`](../docs/VPS_DEPLOYMENT.md).
