# WHMCS Tools Center - All-in-One Tools Marketplace

## Project Structure

```
whmcs-tools-center/
├── external-api/               # External PHP Tools API
│   ├── api.php                 # Main API entry point
│   ├── config.php              # API configuration
│   ├── auth.php                # Token authentication
│   ├── cache.php               # Caching system
│   ├── rate-limit.php          # Rate limiting
│   ├── tools/                  # Tool modules
│   │   ├── search.php          # Search tools
│   │   ├── dns.php             # DNS tools
│   │   ├── ip.php              # IP tools
│   │   ├── developer.php       # Developer tools
│   │   ├── designer.php        # Designer tools
│   │   ├── webmaster.php       # Webmaster tools
│   │   ├── network.php         # Network tools
│   │   ├── security.php        # Cyber security tools
│   │   ├── productivity.php    # Productivity tools
│   │   └── gaming.php          # Gaming tools
│   └── logs/                   # API logs directory
│
└── whmcs-addon/                # WHMCS Addon Module
    ├── tools_center.php        # Main addon file
    ├── hooks.php               # WHMCS hooks
    ├── templates/              # Template files
    │   ├── clientareaheader.tpl
    │   ├── clientareadashboard.tpl
    │   └── tools/              # Tool category templates
    ├── css/                    # Stylesheets
    ├── js/                     # JavaScript files
    └── install.sql             # Database installation
```

## Requirements

- WHMCS 8.x+
- PHP 7.4+
- cURL extension
- Redis (optional, for caching)
- WHMCS Client Area access

## Installation

1. Upload `external-api` to a separate server or subdirectory outside WHMCS root
2. Upload `whmcs-addon` to `/modules/addons/tools_center/`
3. Run installation SQL in WHMCS database
4. Activate module in WHMCS Admin > Addon Modules
5. Configure API endpoint and authentication token
6. Set tool access permissions per user group

## Security Notes

- Keep external API outside web root if possible
- Use HTTPS for all API communications
- Rotate authentication tokens regularly
- Monitor rate limit logs for abuse
- Never execute shell commands with user input directly