# HostX Email Provisioning Module for WHMCS

A comprehensive WHMCS server provisioning module for selling and managing email hosting services across three providers: Professional Email (IMAP/SMTP), Microsoft 365, and Google Workspace.

## Version

**1.0.0**

## Requirements

- WHMCS 8.9+
- PHP 7.4+
- PHP Extensions: cURL, OpenSSL, JSON, PDO, filter
- Working WHMCS cron job for automated synchronization

## Installation

### Step 1: Upload Files

1. Extract the module files
2. Upload the entire `hostx_email/` folder to `/modules/servers/` in your WHMCS installation
3. The final path should be: `/modules/servers/hostx_email/`

```
modules/servers/hostx_email/
├── hostx_email.php    # Main module file
├── functions.php      # Shared utilities and helpers
├── api.php            # API integrations (MS365, Google, Professional)
├── webhook.php        # Async webhook handler
├── templates/
│   ├── overview.tpl   # Client area main view
│   └── error.tpl      # Client area error display
└── README.md          # This file
```

### Step 2: Activate the Module

1. Log in to your WHMCS Admin area
2. Go to **System Settings > Products/Services > Servers**
3. Click **Add New Server**
4. Fill in the server details:

#### Server Settings

| Field | Value | Description |
|-------|-------|-------------|
| Name | HostX Email | Any name you prefer |
| Hostname | `api.hostx-email.com` | Your email API hostname |
| IP Address | `https://api.hostx-email.com` | Professional Email API base URL |
| Assigned IP Addresses | (leave blank) | |

#### Professional Email Settings (Default Provider)

| Field | Value | Description |
|-------|-------|-------------|
| Username | (API username) | Your Professional Email API username |
| Password | (API key) | Your Professional Email API key |

#### Microsoft 365 Settings

| Field | Value | Description |
|-------|-------|-------------|
| Access Hash | (Client ID) | Microsoft Graph API Client ID |
| Password | (Client Secret) | Microsoft Graph API Client Secret |
| Username | (Tenant ID) | Microsoft 365 Tenant ID |

#### Google Workspace Settings

Store your Google Service Account JSON in the module's custom configuration (see Product Setup below).

### Step 3: Create Products

1. Go to **System Settings > Products/Services > Products**
2. Click **Create a New Product**
3. For each product:
   - Select **Server/Provisioning Module** as the product type
   - Choose **HostX Email Hosting** from the Module dropdown
   - Configure the **Module Settings** tab:

#### Module Settings per Product

| Setting | Options | Description |
|---------|---------|-------------|
| Email Provider | Professional Email / Microsoft 365 / Google Workspace | Which email service |
| Plan Type | Basic / Standard / Premium | Plan tier |
| Mailbox Size | Number (GB) | Storage quota |
| Max Aliases | Number | Maximum email aliases |
| Enable DNS Management | Yes/No | Show DNS records to client |

### Step 4: Configure Google Workspace (if using)

For Google Workspace products, you need to store the service account JSON:

1. Go to **Google Cloud Console > IAM & Admin > Service Accounts**
2. Create a service account with Domain-Wide Delegation
3. Download the JSON key file
4. In WHMCS, go to the product's **Module Settings**
5. Paste the JSON content into the **Google Service Account JSON** field (Config Option 7)

### Step 5: Webhook Setup (Optional but Recommended)

To receive real-time updates from providers:

1. For **Microsoft 365**: Configure change notifications in Azure AD to point to:
   ```
   https://your-whmcs.com/modules/servers/hostx_email/webhook.php?provider=microsoft365
   ```

2. For **Google Workspace**: Set up push notifications in Google Admin Console to:
   ```
   https://your-whmcs.com/modules/servers/hostx_email/webhook.php?provider=google_workspace
   ```

3. For **Professional Email**: Configure webhook URL in your email platform:
   ```
   https://your-whmcs.com/modules/servers/hostx_email/webhook.php?provider=professional
   ```

## Features

### Client Area
- **Account Overview**: Email address, provider, plan, and status
- **Quick Login Links**: Direct links to Outlook, Gmail, or Webmail
- **Password Reset**: Self-service password change with validation
- **DNS Records**: Display and copy DNS records (MX, SPF, DKIM, DMARC)
- **One-Click Copy**: Copy individual or all DNS records
- **Status Indicator**: Real-time account status (Active/Suspended)

### Admin Area
- **Server Management**: Centralized API credential management
- **Custom Buttons**: Sync Account Status, Reset Password
- **Account Details**: View provider, external ID, and creation date
- **API Connection Test**: Built-in connectivity verification

### Automation
- **Auto-Provisioning**: Accounts created automatically after payment
- **Daily Sync**: Status synchronization via WHMCS cron
- **Payment Hook**: Pending accounts activated on invoice payment
- **Webhook Processing**: Real-time status updates from providers

### Security
- **Encrypted Credentials**: AES-256 encryption for API keys
- **Input Validation**: All user inputs sanitized and validated
- **Rate Limiting**: API request throttling to prevent abuse
- **Webhook Verification**: Signature validation for incoming webhooks
- **Audit Logging**: All API calls logged with sanitized credentials

## API Reference

### Microsoft 365 (Microsoft Graph API)

| Function | Endpoint | Method |
|----------|----------|--------|
| Create User | `/users` | POST |
| Assign License | `/users/{id}/assignLicense` | POST |
| Suspend User | `/users/{email}` | PATCH |
| Delete User | `/users/{email}` | DELETE |
| Change Password | `/users/{email}` | PATCH |

### Google Workspace (Admin SDK)

| Function | Endpoint | Method |
|----------|----------|--------|
| Create User | `/users` | POST |
| Assign License | Licensing API | PUT |
| Suspend User | `/users/{email}` | PUT |
| Delete User | `/users/{email}` | DELETE |
| Change Password | `/users/{email}` | PUT |

### Professional Email (REST API)

| Function | Endpoint | Method |
|----------|----------|--------|
| Create Mailbox | `/api/v1/mailboxes` | POST |
| Suspend Mailbox | `/api/v1/mailboxes/{email}` | PATCH |
| Delete Mailbox | `/api/v1/mailboxes/{email}` | DELETE |
| Change Password | `/api/v1/mailboxes/{email}/password` | POST |

## DNS Records Provided

### Microsoft 365
- MX record pointing to Outlook protection
- SPF record for Outlook
- CNAME for AutoDiscover
- DMARC policy record

### Google Workspace
- 5 MX records for Gmail
- SPF record for Google
- CNAME for mail access
- DMARC policy record

### Professional Email
- 2 MX records (primary + backup)
- A records for mail server
- SPF record
- CNAME for webmail
- DMARC policy record

## Logging

The module logs all API activity to:
- **WHMCS Module Log**: Standard WHMCS logging (Utilities > Logs > Module Log)
- **Database Tables**:
  - `mod_hostx_email_accounts` - Account data
  - `mod_hostx_email_api_logs` - API request/response logs (30-day retention)
  - `mod_hostx_email_webhook_logs` - Webhook event logs

## Troubleshooting

### Common Issues

**Module not appearing in WHMCS**
- Verify files are in `/modules/servers/hostx_email/`
- Check file permissions (644 for PHP files, 755 for directory)
- Check WHMCS error logs

**"API credentials not configured" error**
- Verify server credentials in System Settings > Servers
- For Microsoft 365: Ensure Access Hash (Client ID) is set
- For Google Workspace: Ensure service account JSON is in Config Option 7

**"Failed to authenticate" error**
- Verify API credentials are correct
- Check if API keys have expired
- For Microsoft 365: Ensure application has necessary Graph API permissions
- For Google Workspace: Ensure domain-wide delegation is enabled

**Client area shows blank page**
- Check WHMCS PHP error log
- Verify template files exist in `/templates/` directory
- Ensure Smarty template syntax is correct

### Debug Mode

Enable detailed logging by adding to `configuration.php`:
```php
$display_errors = true;
```

View module-specific logs in **Utilities > Logs > Module Log**.

## Support

For technical support, feature requests, or bug reports:
- Open a support ticket through your client area
- Email: support@hostx.com

## License

This module is proprietary software. Unauthorized distribution is prohibited.

## Changelog

### Version 1.0.0 (2025-04-27)
- Initial release
- Microsoft 365 integration via Graph API
- Google Workspace integration via Admin SDK
- Professional Email (IMAP/SMTP) integration
- Client area with DNS management
- Webhook processing for real-time updates
- Automated provisioning and status sync
- AES-256 encrypted credential storage
