# CloudHost247 Isc LTE Proxy Reseller Module

A comprehensive, production-ready WHMCS provisioning module that integrates with the CloudHost247 LTE Proxy API. Provides full proxy reselling capabilities with modern UI, real-time management, and complete automation.

## Version
**1.0.0** | PHP 8.0+ | WHMCS 8.0+

---

## Features

### Core Functionality
- **Full API Integration** - All 22 API endpoints implemented
- **Automatic Provisioning** - Proxies provisioned instantly after payment
- **Suspend/Unsuspend/Terminate** - Full lifecycle management
- **Order Renewal** - Automatic and manual renewal support
- **Trial Proxies** - Configurable trial period support

### Proxy Management
- **Region Selection** - US (East/West/Central), Canada, UK, Germany, France, Netherlands
- **Carrier Selection** - Verizon, AT&T, T-Mobile, Sprint, US Cellular, International carriers
- **Protocol Selection** - SOCKS5, HTTPS, HTTP
- **Connection Types** - WiFi, Cellular, WiFi & Cellular
- **IP Rotation** - Manual, timed, per-request, or disabled
- **Authentication** - IP whitelist, username/password, or both
- **1:1 Proxies** - Dedicated proxy support with IP revelation

### Client Area
- **Modern Dashboard** - Responsive design with real-time stats
- **Tabbed Interface** - Proxies, Management, Speed Test, Rotation, History
- **AJAX Operations** - No page reloads for any action
- **Copy to Clipboard** - One-click proxy copying
- **Speed Testing** - Individual and batch proxy testing
- **Rotation Timers** - Live countdown to next rotation
- **Usage Statistics** - Request counts and bandwidth tracking

### Admin Area
- **Service Management** - Full admin control over proxy services
- **Custom Buttons** - Rotate All, Test All, Sync, Extend, Reveal IPs
- **Connection Testing** - Built-in API connectivity test
- **Logging System** - Structured logs with configurable levels
- **Rate Limiting** - Configurable API rate limit protection

### Security & Reliability
- **CSRF Protection** - All AJAX requests validated
- **Input Sanitization** - All inputs sanitized and validated
- **Secure Logging** - Sensitive data masked in logs
- **Rate Limiting** - Built-in API rate limit handling
- **Error Handling** - Graceful failure with user-friendly messages
- **Request Retry** - Automatic retry on transient failures
- **Response Caching** - Configurable cache for performance

---

## Requirements

- WHMCS 8.0 or higher
- PHP 8.0 or higher
- cURL extension
- JSON extension
- PDO extension
- OpenSSL extension

---

## Installation

### 1. Upload Files

Upload the module folder to your WHMCS installation:

```bash
/modules/servers/cloudhost247_lteproxy/
```

Ensure the following structure:
```
cloudhost247_lteproxy/
├── cloudhost247_lteproxy.php      # Main module file
├── install.php                     # Installation checker
├── lib/
│   ├── ApiClient.php               # API communication
│   ├── ApiException.php            # Exception handling
│   ├── Logger.php                  # Logging system
│   ├── Cache.php                   # Response caching
│   ├── RateLimiter.php             # Rate limiting
│   └── Helpers.php                 # Utility functions
├── hooks/
│   ├── Automation.php              # Auto-provisioning hooks
│   ├── AdminSidebar.php            # Admin menu hooks
│   └── Notifications.php           # Email notifications
├── ajax/
│   ├── proxy-operations.php        # Proxy CRUD operations
│   ├── proxy-test.php              # Speed/alive testing
│   └── stats.php                   # Statistics retrieval
├── templates/
│   ├── admin/
│   │   └── dashboard.tpl           # Admin dashboard
│   └── client/
│       ├── dashboard.tpl           # Client dashboard
│       └── error.tpl               # Error display
├── assets/
│   ├── css/
│   │   ├── client.css              # Client styles
│   │   └── admin.css               # Admin styles
│   └── js/
│       ├── client.js               # Client scripts
│       └── admin.js                # Admin scripts
├── lang/
│   └── english.php                 # Language file
└── README.md                       # This file
```

### 2. Set Permissions

Ensure the following directories are writable:

```bash
chmod -R 755 /modules/servers/cloudhost247_lteproxy/logs
chmod -R 755 /modules/servers/cloudhost247_lteproxy/cache
```

### 3. Verify Installation

Run the installation checker:

```bash
cd /modules/servers/cloudhost247_lteproxy
php install.php
```

### 4. Activate in WHMCS

1. Log in to WHMCS Admin
2. Navigate to **Setup > Products/Services > Products/Services**
3. Create or edit a product
4. Under **Module Settings**, select **CloudHost247 LTE Proxy** as the module
5. Configure your API credentials (see Configuration below)

---

## Configuration

### API Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your CloudHost247 API key | (required) |
| API Secret | Your CloudHost247 API secret | (required) |
| API Base URL | API endpoint URL | `https://api.cloudhost247.com` |
| API Timeout | Request timeout in seconds | 30 |

### Proxy Defaults

| Setting | Options | Default |
|---------|---------|---------|
| Proxy Type | SOCKS5, HTTPS, HTTP | SOCKS5 |
| Connection Type | WiFi, Cellular, WiFi & Cellular | WiFi & Cellular |
| Rotation Type | Manual, Timed, Per Request, Off | Manual |
| Rotation Interval | Minutes between rotations | 60 |
| Region | US, US East, US West, Canada, UK, etc. | US |
| Carrier | Verizon, AT&T, T-Mobile, etc. | Verizon |
| Auth Type | Username/Password, IP Whitelist, Both | Username/Password |

### Feature Toggles

| Setting | Description |
|---------|-------------|
| Enable Trial Proxies | Allow trial proxy requests |
| Trial Duration | Trial period in hours |
| Auto-Provision | Automatically provision after payment |
| Enable Logging | Enable module activity logging |
| Log Level | Debug, Info, Warning, Error |
| Enable Caching | Cache API responses |
| Rate Limit | Maximum requests per minute |

---

## Product Setup Guide

### Creating a Proxy Product

1. Go to **Setup > Products/Services > Products/Services**
2. Click **Create a New Product**
3. Fill in the product details:
   - **Product Type**: Other
   - **Product Name**: LTE Proxy - Verizon US
   - **Module**: CloudHost247 LTE Proxy

4. In the **Module Settings** tab:
   - Enter your API Key and Secret
   - Set default region to `US`
   - Set default carrier to `Verizon`
   - Set proxy type to `SOCKS5`
   - Enable auto-provisioning

5. In the **Pricing** tab:
   - Set your pricing tiers
   - Recommended: Monthly billing cycle

6. Save the product

### Configurable Options

Create configurable options for client customization:

1. Go to **Setup > Products/Services > Configurable Options**
2. Create a new group linked to your proxy product
3. Add options:
   - **Region**: dropdown with region values
   - **Carrier**: dropdown with carrier values
   - **Proxy Type**: SOCKS5, HTTPS, HTTP
   - **Connection Type**: WiFi, Cellular, Both
   - **Rotation Type**: Manual, Timed, Per Request

### Custom Fields

Add custom fields for additional proxy configuration:

1. Go to **Setup > Custom Fields**
2. Add fields:
   - **IP Whitelist**: text input for allowed IPs
   - **Notes**: textarea for client notes

---

## API Endpoints Implemented

### Account
| Method | Endpoint | Function |
|--------|----------|----------|
| GET | /account/info | getAccountInfo |
| GET | /account/balance | getBalance |

### Orders
| Method | Endpoint | Function |
|--------|----------|----------|
| GET | /orders | getOrders |
| GET | /orders/:id/proxies | getOrderProxies |
| GET | /orders/expired | getExpiredOrders |
| POST | /orders/:id/extend | extendOrder |
| POST | /orders/:id/cancel | cancelOrder |

### Proxy Management
| Method | Endpoint | Function |
|--------|----------|----------|
| GET | /proxies/available/1by1 | getAvailable1By1Proxies |
| GET | /proxies/available/us | getAvailableUsProxies |
| GET | /proxies/available/non-us | getAvailableNonUsProxies |
| GET | /proxies/available/us-carrier | getAvailableUsCarrierProxies |
| POST | /proxies/buy/1by1 | buyProxy1By1 |
| POST | /proxies/buy | buyProxy |
| POST | /proxies/:id/client-ip | updateClientIp |
| POST | /proxies/:id/region | updateRegion |
| POST | /proxies/:id/carrier | updateCarrier |
| POST | /proxies/:id/type | updateProxyType |
| POST | /proxies/:id/auth | updateProxyAuth |
| POST | /proxies/:id/rotation | updateProxyRotation |
| POST | /proxies/:id/rotate | rotateProxyIp |
| POST | /proxies/:id/reveal | reveal1By1ProxyIp |

### Testing
| Method | Endpoint | Function |
|--------|----------|----------|
| GET | /proxies/:id/test/alive | testProxyAlive |
| GET | /proxies/:id/test/speed | testProxySpeed |

### Trials
| Method | Endpoint | Function |
|--------|----------|----------|
| POST | /trials | addTrial |

---

## Hooks & Automation

### Implemented Hooks

| Hook | Action |
|------|--------|
| InvoicePaid | Auto-provision on payment |
| ServiceSuspend | Handle suspension |
| ServiceUnsuspend | Handle unsuspension |
| DailyCronJob | Expiry alerts and cleanup |
| AfterModuleCreate | Welcome notification |
| AfterModuleTerminate | Termination notification |
| AfterModuleSuspend | Suspension notification |
| AfterModuleUnsuspend | Reactivation notification |
| PreModuleRenew | Renewal reminder |
| AfterModuleRenew | Renewal confirmation |

---

## Client Area Features

### Dashboard Tabs

1. **My Proxies** - View all active proxies with copy, rotate, test actions
2. **Management** - Change region, carrier, type, and authentication
3. **Speed Test** - Individual and batch proxy testing with quality ratings
4. **Rotation** - View rotation status and countdown timers
5. **History** - Complete order history with timestamps

### Actions Available

- Copy proxy URL or credentials
- Rotate IP manually
- Reveal 1:1 proxy IP
- Test proxy (alive + speed)
- Change region
- Change carrier
- Change proxy protocol
- Update authentication method
- Update rotation settings
- Extend order duration

---

## Admin Features

### Custom Buttons

- **Rotate All IPs** - Rotate all proxies in an order
- **Test All Proxies** - Batch test all proxies
- **Sync Status** - Synchronize order status with API
- **Extend Order** - Extend order duration
- **Reveal 1:1 IPs** - Reveal all 1:1 proxy IPs

### Connection Test

Built-in API connectivity test that validates:
- Authentication credentials
- API endpoint accessibility
- Account status and balance

---

## Troubleshooting

### Common Issues

**API Connection Failed**
- Verify API key and secret are correct
- Check API base URL
- Ensure cURL is enabled in PHP
- Check firewall rules

**Rate Limit Errors**
- Increase rate limit in module settings
- Enable caching to reduce API calls
- Check API dashboard for limits

**Proxies Not Provisioning**
- Verify auto-provision is enabled
- Check product pricing configuration
- Review WHMCS automation settings
- Check module logs for errors

### Log Locations

```
/modules/servers/cloudhost247_lteproxy/logs/cloudhost247_lteproxy.log
```

### Cache Location

```
/modules/servers/cloudhost247_lteproxy/cache/
```

---

## File Structure

```
cloudhost247_lteproxy/
|
|-- cloudhost247_lteproxy.php          Main provisioning module
|-- install.php                         Installation checker
|-- README.md                           Documentation
|
|-- lib/                                Core library classes
|   |-- ApiClient.php                   API communication layer
|   |-- ApiException.php                Custom exception class
|   |-- Cache.php                       File-based caching
|   |-- Helpers.php                     Utility functions
|   |-- Logger.php                      Structured logging
|   |-- RateLimiter.php                 Request rate limiting
|
|-- hooks/                              WHMCS hooks
|   |-- Automation.php                  Provisioning automation
|   |-- AdminSidebar.php                Admin menu items
|   |-- Notifications.php               Email notifications
|
|-- ajax/                               AJAX request handlers
|   |-- proxy-operations.php            Proxy CRUD
|   |-- proxy-test.php                  Testing operations
|   |-- stats.php                       Statistics
|
|-- templates/                          Smarty templates
|   |-- admin/
|   |   |-- dashboard.tpl               Admin dashboard
|   |   |-- settings.tpl                Module settings
|   |
|   |-- client/
|       |-- dashboard.tpl               Client dashboard
|       |-- error.tpl                   Error display
|
|-- assets/                             Static assets
|   |-- css/
|   |   |-- client.css                  Client styles
|   |   |-- admin.css                   Admin styles
|   |
|   |-- js/
|       |-- client.js                   Client scripts
|       |-- admin.js                    Admin scripts
|
|-- lang/                               Language files
|   |-- english.php                     English translations
|
|-- logs/                               Runtime logs (auto-created)
|-- cache/                              Cache files (auto-created)
```

---

## Support

For support and assistance:
- **Company**: CloudHost247 Isc
- **Module Version**: 1.0.0
- **License**: Proprietary

---

## Changelog

### v1.0.0 (2025-01-01)
- Initial release
- Full API integration (22 endpoints)
- Client and admin dashboards
- AJAX-based proxy management
- Speed testing with quality ratings
- IP rotation controls
- Trial proxy support
- Automated provisioning
- Comprehensive logging
- Rate limiting and caching

---

## Security Notes

- All API credentials are stored encrypted in WHMCS database
- Sensitive data is masked in logs
- CSRF tokens protect all AJAX operations
- Input validation on all user inputs
- Output sanitization on all displayed data
- Rate limiting prevents API abuse
- Secure session handling

---

Copyright (c) 2025 CloudHost247 Isc. All rights reserved.
