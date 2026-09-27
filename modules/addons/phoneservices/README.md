# Phone Number Services Platform for WHMCS

A production-ready, scalable WHMCS module providing virtual telecom services including phone numbers, VoIP, SMS, eSIM, and usage tracking with API-first architecture and clean modular design.

---

## Table of Contents

1. [Features](#features)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Provider Setup](#provider-setup)
6. [API Reference](#api-reference)
7. [Webhooks](#webhooks)
8. [Database Schema](#database-schema)
9. [Troubleshooting](#troubleshooting)
10. [License](#license)

---

## Features

### Virtual Phone Numbers
- Purchase virtual numbers (multi-country support: US, GB, CA, AU, DE, FR, NL, ES, IT, JP)
- Local numbers, second phone numbers, toll-free numbers
- Full lifecycle: Activate, Assign, Renew, Suspend, Release
- Country selection during purchase

### VoIP Calling System
- WebRTC browser-based calling
- Incoming & outgoing calls with international support
- Real-time call status: ringing, connected, ended, failed
- Call logs with duration, caller ID, receiver ID, cost, timestamps

### SMS & Messaging
- Send/receive SMS globally
- OTP / 2FA SMS support
- WhatsApp Business API integration
- Email sending via SendGrid
- Message logs and delivery status tracking

### eSIM & Data Services
- Purchase and activate eSIM profiles
- QR code generation for eSIM provisioning
- Global/local data plans
- Real-time data usage tracking
- Plan lifecycle: activate, expire, renew

### Usage & Monitoring
- Track usage for Calls, SMS, Data
- Real-time analytics dashboard for users
- Admin reporting: usage logs, billing reports, transaction history

### Super Admin Panel
- API configuration management
- Pricing control per country/service type
- Enable/disable services dynamically
- User & subscription management
- System-wide logs & analytics
- Transaction monitoring

---

## System Requirements

- WHMCS 8.0+ (Compatible with 7.10+ with minor adjustments)
- PHP 7.4+ (PHP 8.0+ recommended)
- MySQL 5.7+ / MariaDB 10.2+
- Composer 2.0+
- SSL certificate (required for WebRTC and webhooks)

### PHP Extensions Required
- `pdo_mysql`
- `curl`
- `json`
- `mbstring`
- `openssl`
- `gd` (for QR code generation)

---

## Installation

### Step 1: Upload Module

Upload the `phoneservices` directory to your WHMCS installation:

```
/modules/addons/phoneservices/
```

### Step 2: Install Dependencies

```bash
cd /path/to/whmcs/modules/addons/phoneservices
composer install --no-dev --optimize-autoloader
```

If you don't have Composer access on the server, you can:
1. Run `composer install` locally
2. Upload the entire directory including the `vendor/` folder

### Step 3: Activate Module

1. Log in to WHMCS Admin
2. Navigate to **System Settings > Addon Modules**
3. Find **Phone Number Services Platform**
4. Click **Activate**
5. The module will automatically create all required database tables

### Step 4: Configure Access Control

1. In the Addon Modules list, click **Configure** next to Phone Services
2. Select which admin roles can access the module
3. Save changes

---

## Configuration

### API Credentials

Navigate to **Addons > Phone Number Services Platform > API Configuration**

Configure the following providers:

#### Twilio (SMS, Voice, Numbers)
- Account SID
- Auth Token

#### Vonage (SMS, Voice)
- API Key
- API Secret

#### Airalo (eSIM)
- API Token

#### Truphone (eSIM)
- API Key

#### SendGrid (Email)
- API Key

#### WhatsApp Business
- Business Token
- Phone Number ID (set in settings table)

### Feature Toggles

Enable or disable services dynamically from the API Configuration page:
- Virtual Numbers
- VoIP Calling
- SMS Messaging
- eSIM Services

### Pricing Control

Navigate to **Addons > Phone Number Services Platform > Pricing Control**

Set rates per:
- Service type (voice, sms, number)
- Country (ISO 2-letter code)
- Rate per minute / per unit / monthly cost / setup cost

---

## Provider Setup

### Provider Abstraction Architecture

The module uses a provider abstraction layer (`TelecomProviderInterface`) allowing seamless provider switching without code changes.

```php
// Get default provider
$provider = ProviderFactory::getDefaultProvider();

// Get provider for specific service
$smsProvider = ProviderFactory::getProviderForService('sms', 'twilio');

// Switch provider dynamically
$provider = ProviderFactory::getProvider('vonage');
```

### Supported Providers

| Provider | SMS | Voice | Numbers | WebRTC | eSIM |
|----------|-----|-------|---------|--------|------|
| Twilio   | Yes | Yes   | Yes     | Yes    | No   |
| Vonage   | Yes | Yes   | Yes     | Yes    | No   |
| Airalo   | No  | No    | No      | No     | Yes  |
| Truphone | No  | No    | No      | No     | Yes  |

---

## API Reference

### REST API Base URL

```
https://yourdomain.com/modules/addons/phoneservices/api/rest.php
```

### Authentication

API requests support two authentication methods:

1. **WHMCS Session**: For browser-based requests (client area)
2. **API Key / JWT**: For programmatic access

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://yourdomain.com/modules/addons/phoneservices/api/rest.php/api/numbers
```

### Endpoints

#### Numbers
- `GET /api/numbers` - List numbers
- `POST /api/numbers/purchase` - Purchase number
- `POST /api/numbers/:id/renew` - Renew number
- `POST /api/numbers/:id/suspend` - Suspend number
- `POST /api/numbers/:id/release` - Release number

#### VoIP
- `GET /api/voip/calls` - List call logs
- `POST /api/voip/call` - Initiate call
- `POST /api/voip/call/:id/end` - End call
- `GET /api/voip/token` - Get WebRTC token

#### SMS
- `GET /api/sms/messages` - List messages
- `POST /api/sms/send` - Send SMS
- `POST /api/sms/otp` - Send OTP
- `POST /api/sms/whatsapp` - Send WhatsApp
- `POST /api/sms/email` - Send Email

#### eSIM
- `GET /api/esim/profiles` - List eSIMs
- `POST /api/esim/purchase` - Purchase plan
- `GET /api/esim/:id/qrcode` - Get QR code
- `GET /api/esim/plans` - List available plans

#### Usage
- `GET /api/usage` - Usage summary
- `GET /api/usage/transactions` - Transaction history
- `GET /api/usage/report` - System report

---

## Webhooks

### Twilio Webhooks

Configure the following URLs in your Twilio console:

- **Voice URL**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/twilio.php?type=voice`
- **SMS URL**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/twilio.php?type=sms`
- **Status Callback**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/twilio.php?type=status`

### Vonage Webhooks

Configure in your Vonage dashboard:

- **Inbound SMS**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/vonage.php?type=sms`
- **Voice Answer**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/vonage.php?type=voice`
- **Voice Event**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/vonage.php?type=voice`
- **DLR**: `https://yourdomain.com/modules/addons/phoneservices/api/webhooks/vonage.php?type=dlr`

---

## Database Schema

The module creates the following tables on activation:

- `mod_phoneservices_settings` - Module configuration
- `mod_phoneservices_numbers` - Virtual phone numbers
- `mod_phoneservices_calls` - Call logs
- `mod_phoneservices_messages` - SMS/WhatsApp/Email logs
- `mod_phoneservices_otp` - OTP codes
- `mod_phoneservices_esims` - eSIM profiles
- `mod_phoneservices_usage` - Usage records
- `mod_phoneservices_transactions` - Billing transactions
- `mod_phoneservices_pricing` - Pricing rules
- `mod_phoneservices_logs` - System logs
- `mod_phoneservices_webrtc_tokens` - WebRTC tokens

---

## Troubleshooting

### Provider Not Available
- Check API credentials in **API Configuration**
- Verify provider test connection
- Check `mod_phoneservices_logs` table for errors

### WebRTC Not Working
- Ensure site uses HTTPS
- Check Twilio credentials and TwiML app configuration
- Verify browser permissions for microphone

### Webhooks Not Receiving
- Ensure URLs are publicly accessible (not behind auth)
- Check firewall / CDN rules
- Verify SSL certificate is valid
- Check logs for webhook payloads

### Database Errors
- Ensure MySQL user has CREATE TABLE privileges
- Check collation compatibility (utf8mb4)
- Review `mod_phoneservices_logs` for SQL errors

### Composer Autoload Issues
- Run `composer dump-autoload`
- Ensure `vendor/autoload.php` exists
- Check PHP version compatibility

---

## File Structure

```
modules/addons/phoneservices/
├── phoneservices.php          # Main module file
├── composer.json              # Dependencies
├── hooks.php                  # WHMCS hooks
├── README.md                  # This file
├── lib/
│   ├── Core/
│   │   ├── Module.php         # Core module logic
│   │   ├── Config.php         # Configuration manager
│   │   ├── Logger.php         # Logging system
│   │   ├── Database.php       # Database helper
│   │   └── Router.php         # REST API router
│   ├── Interfaces/
│   │   ├── TelecomProviderInterface.php
│   │   ├── NumberProviderInterface.php
│   │   ├── VoiceProviderInterface.php
│   │   ├── SmsProviderInterface.php
│   │   └── EsimProviderInterface.php
│   ├── Providers/
│   │   ├── AbstractProvider.php
│   │   ├── ProviderFactory.php
│   │   ├── TwilioProvider.php
│   │   ├── VonageProvider.php
│   │   ├── AiraloProvider.php
│   │   └── TruphoneProvider.php
│   ├── Services/
│   │   ├── NumberService.php
│   │   ├── VoipService.php
│   │   ├── SmsService.php
│   │   ├── EsimService.php
│   │   ├── UsageService.php
│   │   └── PricingService.php
│   ├── Models/
│   │   └── (Model classes for ORM extensions)
│   └── API/
│       ├── Middleware/
│       │   └── AuthMiddleware.php
│       └── Controllers/
│           ├── BaseController.php
│           ├── NumbersController.php
│           ├── VoipController.php
│           ├── SmsController.php
│           ├── EsimController.php
│           └── UsageController.php
├── templates/
│   ├── admin/
│   │   ├── dashboard.tpl
│   │   ├── api_config.tpl
│   │   ├── pricing.tpl
│   │   ├── numbers.tpl
│   │   ├── voip.tpl
│   │   ├── sms.tpl
│   │   ├── esim.tpl
│   │   ├── usage.tpl
│   │   ├── transactions.tpl
│   │   ├── users.tpl
│   │   └── logs.tpl
│   └── client/
│       ├── dashboard.tpl
│       ├── numbers.tpl
│       ├── voip.tpl
│       ├── sms.tpl
│       ├── esim.tpl
│       └── usage.tpl
├── assets/
│   ├── css/
│   │   ├── admin.css
│   │   └── client.css
│   └── js/
│       ├── admin/
│       │   └── app.js
│       └── client/
│           └── app.js
├── api/
│   ├── rest.php               # REST API entry
│   └── webhooks/
│       ├── twilio.php
│       └── vonage.php
├── install/
│   ├── schema.sql             # Database schema
│   └── migrations/            # Future migrations
└── lang/
    └── english.php            # Language strings
```

---

## Security Considerations

1. **API Keys**: Never commit credentials to version control
2. **Webhooks**: Validate webhook signatures where supported
3. **HTTPS**: Always use HTTPS in production
4. **Rate Limiting**: Implement rate limiting on API endpoints for production use
5. **Input Validation**: All inputs are escaped using WHMCS database helpers
6. **JWT**: Store `jwt_secret` securely in module settings

---

## Development

### Running Tests

```bash
composer install
vendor/bin/phpunit tests/
```

### Adding a New Provider

1. Create a new class in `lib/Providers/` implementing the relevant interfaces
2. Register it in `ProviderFactory::getProvider()`
3. Add configuration fields in `phoneservices_config()`
4. Update provider capabilities documentation

### Extending Services

1. Create service class in `lib/Services/`
2. Add API controller in `lib/API/Controllers/`
3. Register routes in `Core/Router.php`
4. Add admin/client templates

---

## License

This module is proprietary software. All rights reserved.

---

## Support

For support, documentation updates, or feature requests, contact the development team.

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Compatible With**: WHMCS 8.0+, PHP 7.4+
