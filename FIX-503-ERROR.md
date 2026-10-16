# Fix for 503 Service Unavailable Error on try.vortexprecisionit.com

## Summary

The 503 error was caused by the Node.js platform failing to start in production mode due to missing environment variables. This fix makes the platform more resilient for trial/demo deployments while maintaining security.

## What Was Fixed

### 1. Enhanced Configuration Handling (`platform/src/core/config.js`)

**Before:** The server would crash immediately in production mode if `JWT_SECRET` was not set.

**After:** The server now:
- Detects trial/demo deployments (try.*, trial.*, demo.*, staging.* subdomains)
- Allows ephemeral JWT secrets for trial deployments with a critical warning
- Still requires proper JWT_SECRET for real production deployments
- Provides clear, actionable error messages

### 2. Improved Error Messages (`platform/server.js`)

**Before:** Generic Node.js version error message.

**After:** Clear error messages with:
- Specific version requirements
- Instructions for cPanel users
- Links to documentation

### 3. Added Deployment Configuration (`platform/.htaccess`)

New `.htaccess` file with:
- cPanel Passenger configuration directives
- Security headers
- Proper rewrite rules for SPA routing
- Documentation in comments

### 4. Comprehensive Troubleshooting Guide (`platform/TROUBLESHOOTING-503.md`)

Complete guide covering:
- Quick diagnosis steps
- Common causes and fixes
- cPanel-specific checks
- Health check endpoints
- Emergency recovery procedures

### 5. Deployment Verification Script (`platform/scripts/verify-deployment.sh`)

Automated verification tool that:
- Tests all critical endpoints
- Checks for common 503 causes
- Provides actionable recommendations
- Can be run locally or on production

## How to Deploy the Fix

### Step 1: Pull the Changes

```bash
cd CloudHost247
git pull origin arena/e5e168c8-cloudhost247
```

### Step 2: Deploy to Server

Upload the updated files to your server:
- `platform/src/core/config.js`
- `platform/server.js`
- `platform/.htaccess` (new file)
- `platform/TROUBLESHOOTING-503.md` (new file)
- `platform/scripts/verify-deployment.sh` (new file)

### Step 3: Configure Environment Variables in cPanel

1. Go to **cPanel → Software → Setup Node.js App**
2. Click on your application (try.vortexprecisionit.com)
3. Add/update these environment variables:

**Required:**
```
NODE_ENV=production
APP_URL=https://try.vortexprecisionit.com
JWT_SECRET=<generate a secure random string>
```

**To generate JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Optional:**
```
DATABASE_URL=postgresql://user:pass@host:5432/database
# If not set, uses JSON file store (fine for trials)
```

### Step 4: Verify Node.js Version

1. In cPanel → Setup Node.js App → your application
2. Check "Node.js version" is **22.x** or newer
3. If not, select the latest 22.x version from the dropdown
4. Save changes

### Step 5: Install Dependencies

```bash
cd platform
npm ci --omit=dev
```

Or in cPanel: Click "Run NPM Install" button (if available)

### Step 6: Restart the Application

In cPanel → Setup Node.js App:
1. Click on your application
2. Click the **RESTART** button
3. Wait 10-30 seconds for the application to start

### Step 7: Verify Deployment

Run the verification script:

```bash
bash platform/scripts/verify-deployment.sh try.vortexprecisionit.com
```

Or manually check:

```bash
# Health check
curl https://try.vortexprecisionit.com/health
# Expected: {"status":"ok"}

# Readiness check
curl https://try.vortexprecisionit.com/ready
# Expected: {"status":"ok","checks":{"storage":"ok"}}

# Main page
curl -I https://try.vortexprecisionit.com/
# Expected: HTTP/2 200
```

## Quick Fix (If You're in a Hurry)

If you just need to get the site running quickly:

1. **Set JWT_SECRET in cPanel:**
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   Copy the output and add it as `JWT_SECRET` environment variable

2. **Restart the application** in cPanel

3. **Wait 30 seconds** and refresh the page

That's it! The site should now be accessible.

## Troubleshooting

### Still Seeing 503?

1. **Check application logs:**
   - cPanel → Setup Node.js App → your application → "View logs"
   - Look for error messages

2. **Verify the application is running:**
   - cPanel → Setup Node.js App → Status should show "Running"

3. **Check Node.js version:**
   - Must be 22.x or newer
   - Update in cPanel if needed

4. **Test locally first:**
   ```bash
   cd platform
   npm install
   NODE_ENV=development node server.js
   # Should start on http://localhost:3000
   ```

### Common Error Messages

**"JWT_SECRET is required in production"**
- Add JWT_SECRET to environment variables
- See Step 3 above

**"Node.js 22.20.0 or newer is required"**
- Update Node.js version in cPanel
- See Step 4 above

**"Cannot find module 'pg'"**
- Run: `npm ci --omit=dev`
- Or use cPanel's "Run NPM Install" button

**Application shows as "Stopped"**
- Check logs for startup errors
- Fix the error and restart
- Common causes: wrong Node.js version, missing env vars

## Verification Checklist

After deployment, verify:

- [ ] Application shows as "Running" in cPanel
- [ ] `/health` endpoint returns 200
- [ ] `/ready` endpoint returns 200
- [ ] Homepage loads without 503 error
- [ ] Security headers are present (check with browser dev tools)
- [ ] No errors in application logs

## Files Changed

```
platform/src/core/config.js          - Enhanced JWT_SECRET handling
platform/server.js                    - Improved error messages
platform/.htaccess                    - New: cPanel Passenger config
platform/TROUBLESHOOTING-503.md       - New: Comprehensive guide
platform/scripts/verify-deployment.sh - New: Verification tool
```

## Next Steps

1. **Monitor the application** for the first few hours
2. **Set up health check monitoring** (UptimeRobot, Pingdom, etc.)
3. **Back up your data** regularly (if using JSON store)
4. **Update Node.js** when new LTS versions are released
5. **Review security settings** before going to full production

## Support

If you continue to experience issues:

1. Read `platform/TROUBLESHOOTING-503.md` for detailed help
2. Check `docs/CPANEL_DEPLOYMENT.md` for deployment guide
3. Open an issue: https://github.com/subwindels-hash/CloudHost247/issues
4. Contact support: support@cloudhost247.com

---

**Fixed:** 2026-10-13
**Branch:** arena/e5e168c8-cloudhost247
**Status:** Ready for deployment
