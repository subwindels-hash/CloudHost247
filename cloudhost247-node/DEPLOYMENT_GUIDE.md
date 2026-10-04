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

## Files Generated

✅ **Deployment Package**: `release/cloudhost247-cpanel-df2ef1c.zip` (2.3MB)
- Contains pre-compiled server and frontend assets
- Includes all database migrations (0001-0070)
- Ready for production deployment

✅ **Environment Configuration**: `.env.production`
- Complete set of environment variables
- All secrets pre-generated with cryptographically secure values
- Template for your actual deployment values

✅ **Simplified Environment**: `.env`
- Essential variables only
- Placeholder values for database and provider credentials
- Easier to customize for your specific setup

## Quick Start Deployment

### Step 1: Download the Deployment Package

The deployment zip file has been created at:
```
cloudhost247-node/release/cloudhost247-cpanel-df2ef1c.zip
```

### Step 2: Upload to cPanel

1. Log in to your cPanel account
2. Navigate to **File Manager**
3. Upload the zip file to your home directory
4. Extract the zip file
5. Move the contents of `cloudhost247-cpanel-df2ef1c/` to your desired application root (e.g., `cloudhost247`)

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
2. Add each variable from the `.env` file (excluding PORT - Passenger sets this automatically)

**Option B:** Upload the `.env` file
1. Upload your customized `.env` file to the application root
2. Set file permissions to 600: `chmod 600 .env`

### Step 5: Install Dependencies

1. On the Application Manager detail page, click **Enter to virtual environment**
2. Run: `npm ci --omit=dev`
   - This installs only production dependencies
   - Uses the exact versions from `package-lock.json`

### Step 6: Run Database Migrations

1. In the virtual environment terminal, run:
   ```bash
   CONFIRM_MIGRATION=yes node dist/database/migrate.js up
   ```
2. Verify migrations applied successfully:
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
| `JWT_SECRET` | JWT signing secret | Pre-generated in `.env` files |
| `CREDENTIAL_ENCRYPTION_KEY` | Encryption key for secrets | Pre-generated in `.env` files |
| `APP_URL` | Public URL of your app | `https://cloudhost247.com` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `LOG_LEVEL` | `info` | Logging level (error, warn, info, debug) |
| `DATABASE_SSL` | `true` | Enable SSL for database connection |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` | Reject unauthorized SSL certificates |
| `DATABASE_POOL_MAX` | `10` | Maximum database connections in pool |
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

Use a managed PostgreSQL service (AWS RDS, Cloudflare, etc.):
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

## Files Created

- `release/cloudhost247-cpanel-df2ef1c.zip` - Deployment package (2.3MB)
- `.env` - Simplified environment template
- `.env.production` - Complete environment with all pre-generated secrets
- `DEPLOYMENT_GUIDE.md` - This guide

## Next Steps

1. Upload the deployment package to your cPanel
2. Configure your environment variables
3. Set up your database
4. Run migrations
5. Start the application
6. Configure cron job for worker
7. Test thoroughly before going live
