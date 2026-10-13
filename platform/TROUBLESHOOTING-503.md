# Troubleshooting 503 Service Unavailable Error

This guide helps diagnose and fix the "Error 503. Service Unavailable" error on CloudHost247 platform deployments.

## Quick Diagnosis

Run these checks in order:

### 1. Check if the Node.js application is running (cPanel)

```bash
# In cPanel → Software → Setup Node.js App
# Check if your application shows as "Running" or "Stopped"
# If stopped, click the restart button
```

### 2. Check application logs

```bash
# In cPanel → Setup Node.js App → click on your application
# Look for "Application logs" or "stderr.log"
# Common errors:
# - "JWT_SECRET is required in production"
# - "Node.js X.X.X is required"
# - "Cannot find module"
```

### 3. Verify Node.js version

```bash
# In the application's virtual environment terminal:
node --version
# Must be >= 22.20.0 and < 25
# If older, update in cPanel → Setup Node.js App → Node.js version
```

### 4. Check environment variables

```bash
# In cPanel → Setup Node.js App → your application → Environment variables
# Required variables:
# - NODE_ENV=production
# - APP_URL=https://your-domain.com
# - JWT_SECRET=<64+ character random string>
# Optional:
# - DATABASE_URL=postgresql://... (uses JSON store if not set)
```

### 5. Test the application locally

```bash
cd platform
npm install
NODE_ENV=development node server.js
# Should start on http://localhost:3000
# Check /health endpoint: curl http://localhost:3000/health
```

## Common Causes and Fixes

### Cause 1: Missing JWT_SECRET (Most Common)

**Error message:**
```
[server] configuration error: JWT_SECRET is required in production and must be at least 32 characters
```

**Fix:**
```bash
# Generate a secure JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# Add to cPanel → Setup Node.js App → Environment variables:
# JWT_SECRET=<paste the generated value>

# Restart the application
```

### Cause 2: Wrong Node.js Version

**Error message:**
```
[server] FATAL: Node.js 22.20.0 or newer (but below 25) is required.
[server] Current version: 18.x.x
```

**Fix:**
1. Go to cPanel → Setup Node.js App
2. Click on your application
3. Change "Node.js version" to 22.x or newer
4. Save and restart

### Cause 3: Application Not Built (cloudhost247-node only)

**Error message:**
```
[server.js] Compiled application not found at dist/src/server.js.
```

**Fix:**
```bash
# This only applies to cloudhost247-node/, not platform/
cd cloudhost247-node
npm ci
npm run build
# Then restart the application
```

### Cause 4: Database Connection Failed

**Symptoms:**
- Application starts but `/ready` returns 503
- Logs show database connection errors

**Fix:**
```bash
# Check DATABASE_URL format:
# postgresql://username:password@host:port/database

# Test connection:
node scripts/migrate.js status

# If using JSON store (no DATABASE_URL), this doesn't apply
```

### Cause 5: Port Binding Issues

**Symptoms:**
- Application starts but isn't accessible
- Logs show "EADDRINUSE" or similar

**Fix:**
```bash
# Don't hardcode PORT - let cPanel/Passenger inject it
# The server.js automatically uses process.env.PORT

# If testing locally, use:
PORT=3000 node server.js
```

### Cause 6: Missing Dependencies

**Error message:**
```
Error: Cannot find module 'pg'
```

**Fix:**
```bash
cd platform
npm ci --omit=dev
# Restart the application
```

## cPanel-Specific Checks

### Verify Application Configuration

1. **Application root:** Should point to your `platform/` directory
2. **Application URL:** Should match your domain (e.g., `try.vortexprecisionit.com`)
3. **Application startup file:** Must be `server.js`
4. **Application mode:** Should be `Production`

### Check .htaccess Conflicts

If you have a `.htaccess` file in the application root or parent directories, it might conflict with Passenger. The platform includes its own `.htaccess` that's compatible with Passenger.

### Verify File Permissions

```bash
# Application files should be readable:
chmod 644 server.js
chmod 644 package.json
chmod -R 755 src/
chmod -R 755 public/

# Data directory should be writable:
chmod 755 data/
```

## Health Check Endpoints

Once the application is running, verify these endpoints:

```bash
# Liveness check (should return 200)
curl https://try.vortexprecisionit.com/health
# Expected: {"status":"ok"}

# Readiness check (should return 200 if storage is working)
curl https://try.vortexprecisionit.com/ready
# Expected: {"status":"ok","checks":{"storage":"ok"}}

# Main page
curl -I https://try.vortexprecisionit.com/
# Expected: HTTP/2 200
```

## Emergency Recovery

If the application won't start:

1. **Switch to development mode temporarily:**
   ```bash
   # In cPanel → Environment variables:
   NODE_ENV=development
   # Restart - this allows ephemeral JWT_SECRET
   ```

2. **Check stderr logs:**
   ```bash
   # In cPanel → Setup Node.js App → your application
   # Click "View logs" or check stderr.log
   ```

3. **Test locally first:**
   ```bash
   # On your local machine:
   git clone https://github.com/subwindels-hash/CloudHost247
   cd CloudHost247/platform
   npm install
   node server.js
   # Verify it works locally before deploying
   ```

4. **Contact support:**
   If none of the above works, contact CloudHost247 Technical Support with:
   - Node.js version
   - Full stderr.log output
   - Environment variables (redact secrets)
   - cPanel version

## Prevention

To prevent 503 errors in the future:

1. **Always set JWT_SECRET** before deploying to production
2. **Test in development mode** before switching to production
3. **Monitor application logs** after deployment
4. **Use health check monitoring** (e.g., UptimeRobot, Pingdom)
5. **Keep Node.js version updated** to the latest 22.x LTS
6. **Back up your data directory** regularly if using JSON store

## Still Having Issues?

If you've tried all the above and still see 503 errors:

1. Check the CloudHost247 status page
2. Review the deployment guide: `docs/CPANEL_DEPLOYMENT.md`
3. Open an issue on GitHub: https://github.com/subwindels-hash/CloudHost247/issues
4. Contact support: support@cloudhost247.com

---

**Last updated:** 2026-10-13
**Applies to:** CloudHost247 Platform v1.0.0+
