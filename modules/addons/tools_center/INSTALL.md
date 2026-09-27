# WHMCS Tools Center - Installation Guide

## Requirements

- WHMCS 8.0 or later
- PHP 7.4 or later (PHP 8.0+ recommended)
- MySQL 5.7+ / MariaDB 10.2+
- cURL extension enabled
- External server/subdomain for API (recommended) OR subdirectory outside WHMCS web root

## Architecture Overview

```
+---------------+     REST API (JSON)     +------------------+
|  WHMCS Addon  |  <------------------->  |  External Tools  |
|  Module (UI)  |   Token Auth + HTTPS    |  API (PHP)       |
+---------------+                         +------------------+
       |                                          |
       | Hooks Only                               | DNS, WHOIS,
       | No Core Edits                            | Ping, Traceroute,
       |                                          | GeoIP, etc.
+---------------+                                |
|  WHMCS DB     |                                |
|  (logs, usage)|                         +---------------+
+---------------+                         |  External APIs|
                                          |  (VirusTotal, |
                                          |   GeoIP, etc) |
                                          +---------------+
```

## Step 1: Prepare External API Server

### Option A: Separate Server/Subdomain (Recommended)

1. Upload the `external-api/` folder contents to a separate server or subdomain:
   ```
   https://tools-api.yourdomain.com/
   ```

2. Ensure the directory structure is:
   ```
   /api.php              - Main API entry point
   /config.php           - Configuration
   /auth.php             - Authentication
   /cache.php            - Cache manager
   /rate-limit.php       - Rate limiter
   /tools/               - Tool modules
       /search.php
       /dns.php
       /ip.php
       /developer.php
       /designer.php
       /webmaster.php
       /network.php
       /security.php
       /productivity.php
       /gaming.php
   /cache/               - Cache directory (auto-created)
   /logs/                - Log directory (auto-created)
   /temp/                - Temp directory (auto-created)
   ```

3. Set proper permissions:
   ```bash
   chmod 755 cache logs temp
   ```

4. Configure `config.php`:
   ```php
   'api_token' => 'your-very-secure-random-token-here',
   'api_secret' => 'your-very-secure-secret-here',
   ```

5. Set environment variables (recommended for production):
   ```bash
   export TOOLS_API_TOKEN="your-secure-token"
   export TOOLS_API_SECRET="your-secure-secret"
   ```

### Option B: Same Server (Outside Web Root)

If you cannot use a separate server, place the API outside the web root:

```
/home/user/whmcs-tools-api/     <- API files here
/home/user/public_html/whmcs/   <- WHMCS here
```

Create a proxy PHP file in WHMCS that forwards requests:
```php
// In WHMCS root: tools-api-proxy.php
require_once '/home/user/whmcs-tools-api/api.php';
```

## Step 2: Configure External API Security

### Web Server Configuration (Apache/Nginx)

**Apache (.htaccess):**
```apache
# Protect config files
<FilesMatch "^(config|auth|cache|rate-limit)\.php$">
    Order deny,allow
    Deny from all
</FilesMatch>

# Enable CORS for your WHMCS domain
Header set Access-Control-Allow-Origin "https://your-whmcs-domain.com"

# Disable directory listing
Options -Indexes
```

**Nginx:**
```nginx
server {
    listen 443 ssl;
    server_name tools-api.yourdomain.com;
    
    root /var/www/tools-api;
    index api.php;
    
    # Protect sensitive files
    location ~ /(config|auth|cache|rate-limit)\.php$ {
        deny all;
        return 403;
    }
    
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php74-fpm.sock;
        fastcgi_index api.php;
        include fastcgi_params;
    }
    
    # Cache directory protection
    location /cache/ { deny all; }
    location /logs/ { deny all; }
    location /temp/ { deny all; }
}
```

## Step 3: Install WHMCS Addon Module

1. Upload the `whmcs-addon/` folder contents to:
   ```
   /WHMCS_ROOT/modules/addons/tools_center/
   ```

2. Ensure the structure is:
   ```
   /modules/addons/tools_center/
       tools_center.php          - Main addon file
       hooks.php                 - WHMCS hooks
       clientarea.php            - Client area handler
       templates/
           tools/
               dashboard.tpl
               category.tpl
               tool.tpl
       css/
           tools-center.css
       js/
           tools-center.js
   ```

3. Run the database installation:
   ```bash
   mysql -u your_db_user -p your_whmcs_db < install.sql
   ```
   Or execute the SQL via phpMyAdmin / WHMCS Utilities > Database Fix.

## Step 4: Activate Module in WHMCS

1. Login to WHMCS Admin Panel
2. Navigate to: **System Settings > Addon Modules**
3. Find "Tools Center" and click **Activate**
4. Configure settings:
   - **API Endpoint URL**: `https://tools-api.yourdomain.com/api.php`
   - **API Token**: Same token set in external API config
   - **Require Active Product**: Enable if only paid users should access tools
   - **Allowed Client Groups**: Comma-separated group IDs (leave empty for all)
   - **Show in Client Area Menu**: Yes (recommended)
   - **Menu Link Name**: "Tools Center" (or custom name)

5. Click **Save Changes**

6. Set Access Control: Grant permissions to appropriate admin roles

## Step 5: Test the Installation

1. Login to client area
2. Click "Tools Center" in navigation menu
3. Try a simple tool like "What is My IP" or "DNS Lookup"
4. Verify results display correctly

## Step 6: Optional Configuration

### Enable Redis Caching

In `external-api/config.php`:
```php
'cache_driver' => 'redis',
'redis' => [
    'host' => '127.0.0.1',
    'port' => 6379,
    'password' => 'your-redis-password',
    'database' => 0,
],
```

### Rate Limiting Configuration

In `external-api/config.php`:
```php
'rate_limit' => [
    'enabled' => true,
    'requests_per_minute' => 60,
    'requests_per_hour' => 500,
    'requests_per_day' => 5000,
],
```

### External API Keys

Some tools benefit from external API keys:
```php
// VirusTotal for malware checks
'virustotal_api_key' => 'your-api-key',

// IPGeolocation for enhanced GeoIP
'ipgeolocation_api_key' => 'your-api-key',
```

## Troubleshooting

### White Screen / 500 Error

1. Check PHP error logs: `/var/log/php_errors.log`
2. Ensure PHP version is 7.4+
3. Verify file permissions (644 for PHP files, 755 for directories)
4. Check that `cache/`, `logs/`, `temp/` directories are writable

### API Connection Failed

1. Verify API endpoint URL is correct and accessible
2. Check API token matches between WHMCS and external API config
3. Test API directly: `curl -X POST https://tools-api.yourdomain.com/api.php -d '{"category":"ip","action":"whatIsMyIP","api_token":"YOUR_TOKEN"}'`
4. Check firewall rules allow connections

### Tools Not Loading

1. Check browser console for JavaScript errors
2. Verify CSS and JS files are loading (check Network tab)
3. Ensure `clientarea.php` is in the module directory

### Permission Denied for Users

1. Check "Allowed Client Groups" setting
2. If "Require Active Product" is enabled, user must have active service
3. Verify user is logged in (tools require authentication)

## Security Checklist

- [ ] API token is strong (32+ random characters)
- [ ] HTTPS enabled for both WHMCS and API
- [ ] API config files are blocked from web access
- [ ] Rate limiting is enabled
- [ ] Input validation is active
- [ ] Cache directory is outside web root or protected
- [ ] WHMCS admin access controls are configured
- [ ] Regular log monitoring is set up

## Updating

### Update External API
1. Backup existing files
2. Upload new files (preserve `config.php`)
3. Clear cache directory

### Update WHMCS Module
1. Backup existing files
2. Upload new files
3. Deactivate and reactivate in Addon Modules (if database changes)

## Uninstalling

1. Deactivate module in WHMCS: **System Settings > Addon Modules**
2. Optionally drop database tables:
   ```sql
   DROP TABLE IF EXISTS mod_tools_center_logs;
   DROP TABLE IF EXISTS mod_tools_center_usage;
   DROP TABLE IF EXISTS mod_tools_center_notepad;
   DROP TABLE IF EXISTS mod_tools_center_favorites;
   DROP TABLE IF EXISTS mod_tools_center_permissions;
   ```
3. Delete module files from `/modules/addons/tools_center/`

## Support

For issues or questions, refer to the API documentation (API.md) or contact your system administrator.