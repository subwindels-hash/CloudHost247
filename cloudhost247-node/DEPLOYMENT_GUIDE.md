# CloudHost247 Node Platform - Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the CloudHost247 Node.js platform to a cPanel shared hosting environment using Passenger (Application Manager).

## Prerequisites

1. **cPanel Account** with:
   - "Setup Node.js App" (Application Manager) available
   - Node.js 20.9.0 or newer
   - SSH/Terminal access (or cPanel's web-based terminal)
   - PostgreSQL database (or external managed PostgreSQL)

2. **Domain** configured and pointing to your cPanel hosting

3. **SSL Certificate** installed for your domain

## Generated Artifacts (2026-10-04)

- **Deployment ZIP:** `release/cloudhost247-cpanel-b54b047.zip` (2.3 MB; 1,138 files; 70 migrations)
  - Includes compiled server/frontend, production package metadata, migrations, manifests, and `.env.example`.
  - SHA-256: `d2321760556f36cc68e05c9f7dac1691db248b08003fc5820ea1fb6384888236`.
  - The archive passed `unzip -t`; it does **not** contain `.env`, real credentials, or `node_modules`.
- **Full environment file:** `cloudhost247-node/.env` (mode `0600`, git-ignored, not included in the ZIP).
  - App-local secrets were generated with Node's cryptographic random generator.
  - `DATABASE_URL` is deliberately a placeholder, and provider/email credentials are unset. Replace these and verify `APP_URL`/database TLS settings before deploying.
  - `npm run env:check` passes; this validates configuration shape only and does not test database connectivity or provider credentials.

The package build succeeded, the full test suite passed (129 files / 1,158 tests), and environment validation passed in this workspace. This is **not** evidence of a real cPanel/Passenger staging run; see `docs/CPANEL_DEPLOYMENT.md` for prerequisites and the outstanding staging gate.

The ZIP and `.env` are local generated outputs, ignored by Git, and are not included in this PR. Rebuild the ZIP with `bash scripts/package-cpanel.sh`; keep the private `.env` separate and configure it through the hosting provider's secure environment-variable UI where possible.

## Quick Start Deployment

### Step 1: Download the Deployment Package

The deployment zip file is:
```
cloudhost247-node/release/cloudhost247-cpanel-b54b047.zip
```

### Step 2: Upload to cPanel

1. Log in to your cPanel account
2. Navigate to **File Manager**
3. Upload the zip file to your home directory
4. Extract the zip file
5. Move the contents of `cloudhost247-cpanel-b54b047/` to your desired application root (e.g., `cloudhost247`)

### Step 3: Create the Node.js Application

1. In cPanel, go to **Software** → **Setup Node.js App**
2. Click **Create Application**
3. Configure as follows:
   - **Node.js version**: Select version ≥ 20.9.0
   - **Application mode**: Production
   - **Application root**: `cloudhost247` (or your chosen directory)
   - **Application URL**: `https://yourdomain.com` or `https://app.yourdomain.com`
   - **Application startup file**: `server.js`
4. Click **Create**

### Step 4: Configure Environment Variables

**Option A (Recommended):** Use cPanel's Environment Variables UI
1. On the Application Manager detail page, find the **Environment Variables** section
2. Add the active (uncommented) variables from `cloudhost247-node/.env`, after replacing its database placeholder and confirming `APP_URL`; omit PORT because Passenger supplies it automatically. Configure any provider credentials you need separately.

**Option B:** Upload the `.env` file
1. Upload your customized `.env` file to the application root
2. Set file permissions to 600: `chmod 600 .env`

### Step 5: Install Dependencies

1. On the Application Manager detail page, click **Enter to virtual environment**
2. Run: `npm ci --omit=dev`
   - This installs only production dependencies
   - Uses the exact versions from `package-lock.json`

### Step 6: Run Database Migrations

1. Back up the target database and review the pending migration status first. Production migrations `0023`, `0024`, `0025`, and `0041` are quarantined; a fresh production schema needs explicit owner authorization for those migrations. Follow `docs/CPANEL_DEPLOYMENT.md` §0a/§6 before proceeding.
2. If the owner has approved that production change, run:
   ```bash
   CONFIRM_MIGRATION=yes AUTHORIZED_MIGRATIONS=0023,0024,0025,0041 node dist/database/migrate.js up
   ```
3. Verify migrations applied successfully:
   ```bash
   node dist/database/migrate.js status
   node dist/database/migrate.js verify
   ```

### Step 7: Start the Application

1. In cPanel Application Manager, click **Restart**
2. Wait for the application to start (check logs if needed)

### Step 8: Verify Deployment

1. Visit your Application URL in a browser
2. Check health endpoints:
   ```bash
   curl https://yourdomain.com/health
   curl https://yourdomain.com/ready
   ```
3. Test authentication flow:
   - Register a test user
   - Login
   - Access protected routes

## Environment Variables Reference

### Required Variables (Must Configure)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/dbname` |
| `JWT_SECRET` | JWT signing secret | Generated in `cloudhost247-node/.env`; keep private |
| `CREDENTIAL_ENCRYPTION_KEY` | Encryption key for secrets | Generated in `cloudhost247-node/.env`; back it up securely and do not rotate without a migration plan |
| `APP_URL` | Public URL of your app | `https://cloudhost247.com` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | Set to `production` | Production mode (the code default is `development`, so configure this explicitly) |
| `LOG_LEVEL` | `info` | Logging level (error, warn, info, debug) |
| `DATABASE_SSL` | `true` in the generated `.env` | Enable TLS when required by the database provider; confirm cPanel-hosted PostgreSQL settings rather than assuming |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` | Reject unauthorized SSL certificates |
| `DATABASE_POOL_MAX` | `5` | Maximum database connections in pool (raise only after checking the database connection limit) |
| `JWT_EXPIRES_IN` | `12h` | JWT token expiration time |
| `WORKER_CONCURRENCY` | `4` | Maximum concurrent worker jobs |

### Infrastructure Provider Variables

All provider variables are optional. Configure only the providers you plan to use:

- **Hetzner**: `HETZNER_API_TOKEN`
- **DigitalOcean**: `DIGITALOCEAN_API_TOKEN`
- **Vultr**: `VULTR_API_KEY`
- **AWS**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- **Contabo**: `CONTABO_CLIENT_ID`, `CONTABO_CLIENT_SECRET`, `CONTABO_API_USER`, `CONTABO_API_PASSWORD`
- **OVHcloud**: `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`
- **Proxmox**: `PROXMOX_API_URL`, `PROXMOX_API_TOKEN`
- **Virtualizor**: `VIRTUALIZOR_API_URL`, `VIRTUALIZOR_API_KEY`, `VIRTUALIZOR_API_SECRET`
- **SolusVM**: `SOLUSVM_API_URL`, `SOLUSVM_API_ID`, `SOLUSVM_API_KEY`
- **OpenStack**: Multiple variables for authentication

## Database Configuration

### Option 1: cPanel PostgreSQL

1. In cPanel, go to **Databases** → **PostgreSQL Databases**
2. Create a new database (e.g., `cloudhost247_prod`)
3. Create a new user (e.g., `cloudhost247_user`)
4. Add user to database with all privileges
5. Set `DATABASE_URL`:
   ```
   postgresql://cloudhost247_user:your_password@localhost:5432/cloudhost247_prod
   ```

### Option 2: External PostgreSQL

Use a managed PostgreSQL service from your chosen database provider:
```
DATABASE_URL=postgresql://user:password@your-db-host:5432/cloudhost247_prod
DATABASE_SSL=true
```

## Worker Configuration

For cPanel shared hosting, configure a cron job for the worker:

1. In cPanel, go to **Cron Jobs**
2. Add a new cron job:
   ```
   * * * * * cd /home/username/cloudhost247 && /path/to/node dist/src/worker/main.js --once >> /home/username/cloudhost247-worker.log 2>&1
   ```
3. Replace `/path/to/node` with the actual path shown in Application Manager

## Security Checklist

- [ ] `.env` file permissions set to 600
- [ ] No secrets committed to version control
- [ ] Database user has least privileges
- [ ] SSL enabled for all connections
- [ ] Application URL uses HTTPS
- [ ] Rate limiting enabled (default: yes)
- [ ] Security headers enabled (default: yes)

## Troubleshooting

### Application Won't Start

1. Check Application Manager logs
2. Run `npm run env:check` to verify environment variables
3. Ensure `dist/src/server.js` exists (run `npm run build` if missing)

### Database Connection Issues

1. Verify `DATABASE_URL` is correct
2. Test connection: `node dist/database/migrate.js status`
3. Check database host, port, username, password
4. Verify SSL settings match your database provider

### Frontend Not Loading

1. Ensure `public/` directory exists with built assets
2. Verify Application URL matches your domain
3. Check browser console for errors
4. Ensure no Apache rewrite rules conflict with Node.js routing

### A page loads but its API calls come back as HTML

The symptom is a page that renders and then reports that a URL "did not answer with JSON" (older
builds of this app surfaced the browser's own message instead:
`Unexpected token '<', "<!doctype "... is not valid JSON`). It always means the same thing: the
browser asked the application for `/api/...` and something **other than the application** answered,
with the site's own `index.html`. The request was never a request the application could fail — so
nothing on the page is broken, and retrying will not change it.

Work through it in this order:

1. **Open the API URL directly** in a browser tab (the Tools Center offers a link for exactly this).
   It must print JSON. If it prints the site's HTML shell, the request is not reaching Node.
2. **Compare `public/` with `dist/`.** Uploading one without the other produces a page that is newer
   than the code behind it — the classic cause. Both must come from the same build.
3. **Restart the application** in *Setup Node.js App*. Passenger keeps the running code in memory
   until it is restarted, so new files on disk change nothing on their own.
4. **Check for a rewrite rule in front of the app** (a `.htaccess` in the document root, or an
   Apache `ProxyPass` that forwards `/` but not `/api`). Anything that rewrites unknown paths to
   `index.php`/`index.html` will answer every API call with HTML.
5. **Purge the CDN**, if one is in front. A cached `index.html` served for an `/api` path looks
   identical to the above.

The application guarantees its own half of this: any unmatched `/api`, `/health` or `/ready` path
is answered with a JSON 404, never with the SPA shell — including when the app is mounted under a
path prefix. That contract is pinned by `tests/unit/spa-routing.test.ts`.

**Locally and in previews** the same symptom has one cause: the page is being served without the
application behind it. `npm run dev` starts both halves (API on `:3000`, Vite on `:5173`), and
`npm run tools:preview` runs the built frontend *and* the API from a single origin against an
embedded database — which is what a browser actually needs. If the API is not running at all, the
dev server now answers `/api/*` with a JSON 502 saying so, instead of an empty 500.

## Update Procedure

### Source-Only Updates

1. Upload new source files
2. Run `npm run build`
3. Restart application in Application Manager

### Dependency Updates

1. Upload new `package.json` and `package-lock.json`
2. Run `npm ci --omit=dev`
3. Run `npm run build`
4. Restart application

## Important Notes

1. **Never set PORT on cPanel** - Passenger automatically injects the correct port
2. **Always backup database** before running migrations
3. **Verify migrations** after applying with `node dist/database/migrate.js verify`
4. **Restart required** after any frontend build (SPA fallback needs process restart)
5. **Test on staging** before deploying to production

## Generated Files

- `release/cloudhost247-cpanel-b54b047.zip` - Pre-built deployment package (2.3 MB; SHA-256 is listed above)
- `.env` - Full private environment file; update the database URL and deployment-specific values before use. It is git-ignored and excluded from the ZIP.
- `DEPLOYMENT_GUIDE.md` - This guide

## Next Steps

1. Upload the deployment package to your cPanel
2. Configure your environment variables
3. Set up your database
4. Run migrations
5. Start the application
6. Configure cron job for worker
7. Test thoroughly before going live
