# HostX Domain Lookup (formerly "HostX Tools" — Domain Lookup build)

> **Provenance note:** this module was originally built as `hostx_tools` v1.0.0
> (4-tool Domain WHOIS / IP / DNS / Availability toolkit). That name collided with
> the larger tools platform build, which shipped under the same `hostx_tools`
> module name, and WHMCS requires folder name, file name and function prefix to
> match the module name — so this build was renamed to `hostx_domain_lookup`.
> Everything internal now carries the correct name: functions
> (`hostx_domain_lookup_*`), constants (`HOSTX_DOMAIN_LOOKUP_*`), namespace
> (`WHMCS\Module\Addon\HostXDomainLookup`), tables, client-area URLs
> (`index.php?m=hostx_domain_lookup`), assets
> (`assets/css/hostx-domain-lookup.css`, `assets/js/hostx-domain-lookup.js`),
> CSS class prefix (`hostx-domain-lookup-*`) and the admin display name
> ("HostX Domain Lookup").
>
> The tools platform it used to collide with now lives at
> [`modules/addons/cloudhost247_tools/`](../cloudhost247_tools/) — the two are
> different modules and can be activated side by side.

A comprehensive WHMCS addon module providing professional networking tools for domain analysis, IP intelligence, and DNS diagnostics. Built specifically for HostX v2.2.6 theme compatibility.

- **Domain WHOIS** - Look up domain registration details (registrar, dates, name servers, status)
- **IP Lookup** - Get IP geolocation, ISP, ASN, and timezone information
- **DNS Lookup** - Query all DNS record types (A, AAAA, MX, NS, TXT, CNAME, SOA, PTR, SRV, CAA)
- **Domain Availability** - Check domain availability across 19 popular TLDs

## APIs Used

| Service | Type | Purpose |
|---------|------|---------|
| WhatIsMyIP API | Primary | Domain WHOIS lookups |
| PHP Native WHOIS (port 43) | Fallback | Domain WHOIS when API fails |
| IPinfo API | Primary | IP geolocation and ASN data |
| IPWho API | Fallback | IP data when IPinfo fails |
| PHP dns_get_record() | Native | DNS lookups (no external API needed) |

## System Requirements

- WHMCS 8.x (tested on 8.9)
- PHP 7.4 or higher
- MySQL/MariaDB
- IonCube Loader 10/11
- cURL extension
- HostX v2.2.6 theme (optional - works with other themes too)

## Installation

### Step 1: Upload Files

Upload the `hostx_domain_lookup` folder to your WHMCS installation:
```
/modules/addons/
```

The final path should be:
```
/modules/addons/hostx_domain_lookup/
```

### Step 2: Activate Module

1. Login to WHMCS Admin Panel
2. Go to **System Settings** > **Addon Modules**
3. Find **HostX Domain Lookup** in the list
4. Click **Activate**

### Step 3: Configure Module

1. Click **Configure** next to HostX Domain Lookup
2. Enter your API keys:
   - **WhatIsMyIP API Key** - Get from https://www.whatismyip.com/
   - **IPinfo Access Token** - Get from https://ipinfo.io/
   - *(IPWho API Key is optional)*
3. Adjust settings as needed:
   - Cache duration (default: 10 minutes)
   - Cache method (database or file)
   - Request timeout (default: 10 seconds)
   - Rate limiting (default: 30 requests/minute)
4. Enable/disable individual tools
5. Click **Save Changes**

### Step 4: Set Access Control

Grant access to the desired admin roles in the module configuration.

## File Structure

```
/modules/addons/hostx_domain_lookup/
├── hostx_domain_lookup.php          # Main module file
├── hooks.php                 # WHMCS hooks for HostX integration
├── README.md                 # This file
│
├── api/                      # API client classes
│   ├── WhatIsMyIPApi.php    # WhatIsMyIP API client
│   ├── IPinfoApi.php        # IPinfo API client
│   ├── IPWhoApi.php         # IPWho API client
│   └── NativeWhois.php      # Native PHP WHOIS (port 43)
│
├── includes/                 # Core functionality
│   ├── Autoloader.php       # Class autoloader
│   ├── CacheManager.php     # Caching system
│   ├── SecurityManager.php  # Security & rate limiting
│   ├── WhoisTool.php        # WHOIS tool wrapper
│   ├── IpTool.php           # IP tool wrapper
│   ├── DnsTool.php          # DNS tool wrapper
│   ├── DomainAvailability.php # Availability checker
│   └── AjaxHandler.php      # AJAX request handler
│
├── templates/               # Template files
│   ├── client/
│   │   ├── tools.tpl       # Main tools listing page
│   │   └── tool.tpl        # Individual tool page
│   └── admin/
│       ├── dashboard.tpl   # Admin dashboard
│       └── logs.tpl        # Request logs
│
├── assets/                  # Static assets
│   ├── css/
│   │   └── hostx-domain-lookup.css # Module styles
│   └── js/
│       └── hostx-domain-lookup.js  # Module JavaScript
│
└── cache/                   # File cache directory (auto-created)
```

## Database Tables

The module creates the following tables on activation:

- `hostx_domain_lookup_cache` - Stores cached lookup results
- `hostx_domain_lookup_rate_limit` - Tracks rate limiting
- `hostx_domain_lookup_log` - Logs all requests for analytics

## How It Works

### API Priority & Fallback

1. **Primary API** is always tried first
2. If the API fails (timeout, error, no key), it automatically falls back
3. **Fallback** method is used transparently
4. If both fail, a user-friendly error is shown
5. **Results are cached** to prevent duplicate API calls

### Caching

- All results cached for configurable duration (default: 10 minutes)
- Supports both database (Capsule) and file-based caching
- Cache keys are sanitized and hashed
- Automatic cache cleanup of expired entries

### Security

- CSRF token validation on all requests
- Input sanitization for domains, IPs, and DNS types
- Output escaping to prevent XSS
- Rate limiting per IP address per tool
- Secure cURL requests with SSL verification

### Performance

- All requests via AJAX (no page reloads)
- Lazy loading of results
- Configurable timeout (default: 10 seconds)
- Optimized for HostX theme rendering

## Client Area Access

Clients can access tools at:
```
index.php?m=hostx_domain_lookup
```

Individual tools:
- Domain WHOIS: `index.php?m=hostx_domain_lookup&page=tool&tool=domain_whois`
- IP Lookup: `index.php?m=hostx_domain_lookup&page=tool&tool=ip_whois`
- DNS Lookup: `index.php?m=hostx_domain_lookup&page=tool&tool=dns_lookup`
- Domain Availability: `index.php?m=hostx_domain_lookup&page=tool&tool=availability`

## Admin Area

Access the admin dashboard at:
**Addons** > **HostX Domain Lookup**

Features:
- Dashboard with usage statistics
- Request logs with filtering
- Quick links to settings

## Troubleshooting

### Module not showing in client area
- Ensure at least one tool is enabled in configuration
- Check that the module is activated
- Verify file permissions (755 for directories, 644 for files)

### API requests failing
- Verify API keys are entered correctly
- Check that cURL is enabled in PHP
- Enable debug mode to see detailed errors
- Check request logs in admin area

### Cache not working
- Verify `cache/` directory is writable (chmod 755)
- Check database tables exist
- Try switching cache method in settings

### HostX theme integration
- The module auto-detects HostX theme
- Hooks add navigation menu items
- CSS is scoped to avoid conflicts

## API Key Registration

### WhatIsMyIP
1. Visit https://www.whatismyip.com/
2. Sign up for an API account
3. Get your API key from the dashboard

### IPinfo
1. Visit https://ipinfo.io/
2. Sign up for a free account
3. Get your access token from the dashboard

## License

MIT License - See LICENSE file for details

## Support

For support, please contact the HostX Tools Team.

## Changelog

### v1.0.0
- Initial release
- Domain WHOIS with API + native fallback
- IP lookup with dual API fallback
- DNS lookup using native PHP
- Domain availability checker
- Full caching system
- Rate limiting
- Admin dashboard and logs
- HostX v2.2.6 integration
