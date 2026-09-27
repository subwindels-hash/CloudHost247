# WHMCS Digital Products Marketplace Module

A complete solution for selling downloadable digital products, modules, plugins and scripts through WHMCS. Features secure file delivery, version management, license key generation and comprehensive download tracking.

## Features

- **File Upload & Management** - Upload ZIP, PHP, JS and other files via admin panel
- **Product Linking** - Link digital downloads to existing WHMCS products
- **Version Control** - Manage multiple versions per product with changelog support
- **Secure Downloads** - Token-based, time-limited download links (48h default)
- **Download Limits** - Per-product download count restrictions
- **License Keys** - Automatic license key generation per purchase (format: `DP-XXXX-XXXX-XXXX-XXXX`)
- **Download Logs** - Track who downloaded what, when and from which IP
- **Auto-Activation** - Hooks into WHMCS order events to automatically grant access
- **Email Notifications** - Automated email with download link after purchase
- **API Ready** - REST-style API for mobile app integration
- **Client Area** - "My Downloads" section integrated into client area

## Requirements

- WHMCS 8.x
- PHP 7.4 or higher
- MySQL 5.7+ / MariaDB 10.2+
- IonCube Loader (standard WHMCS requirement)

## Installation

### Step 1: Upload Files

1. Upload the `modules/addons/digitalproducts/` folder to your WHMCS installation:
   ```
   /WHMCS_ROOT/modules/addons/digitalproducts/
   ```

### Step 2: Activate Module

1. Login to your WHMCS Admin Panel
2. Navigate to **System Settings > Addon Modules**
3. Find **"Digital Products Marketplace"** in the list
4. Click **Activate**

### Step 3: Configure Permissions

1. After activation, click **Configure**
2. Set your preferred defaults:
   - **Default Download Limit**: Max downloads per purchase (0 = unlimited)
   - **Download Link Expiry**: Hours until link expires (default: 48)
   - **Enable License Keys**: Toggle license key generation
   - **File Storage Path**: Custom path or leave empty for default
   - **Email Delivery**: Send download info after purchase
3. Set **Access Control** - check which admin roles can access

### Step 4: Create Email Template (Optional)

Run this SQL in your WHMCS database to create the email template:

```sql
INSERT INTO tblemailtemplates (type, name, subject, message, plaintext, disabled, custom, language, copyto, blind_copy_to) 
VALUES (
  'product',
  'Digital Product Download Info',
  'Your Digital Product Download is Ready - {$product_name}',
  '<p>Dear {$client_name},</p><p>Thank you for your purchase. Your digital product <strong>{$product_name}</strong> is ready.</p><p><strong>Version:</strong> {$product_version}<br><strong>Download:</strong> <a href="{$download_link}">Click here to download</a><br><strong>License Key:</strong> {$license_key}</p><p>This link expires in 48 hours. Access anytime from your client area "My Downloads" section.</p>',
  0, 0, 1, '', '', ''
);
```

## Setup Guide

### Creating Your First Digital Product

1. **Go to Addon Module**
   - Navigate to **Addons > Digital Products Marketplace**

2. **Link a WHMCS Product**
   - On the Products page, select a WHMCS product from the dropdown
   - Click **Link Product**

3. **Upload a File**
   - Click **Upload File** (or go to the product edit page)
   - Select the product, enter version (e.g. `1.0.0`)
   - Add changelog notes
   - Drag & drop or select your file (ZIP recommended)
   - Click **Upload File**

4. **Set as Current Version**
   - Edit the product and select the uploaded file as "Current File"
   - Or go to **Version Management** and click "Set Active"

5. **Test Purchase**
   - Place a test order for the product
   - After payment, the download will be available in "My Downloads"

### Managing Versions

- Upload new versions with incremented version numbers
- Switch active version at any time (old customers get access to new version)
- View all versions in **Version Management** section
- Delete old versions to free storage space

### License Key System

License keys are automatically generated when:
- Order is paid (via OrderPaid hook)
- Service is created (via AfterModuleCreate hook)

License format: `DP-XXXX-XXXX-XXXX-XXXX` (16 chars after prefix)

Clients can view their license keys in the "My Downloads" section.

## API Documentation

### Authentication

API requests require authentication via Bearer token in the Authorization header:

```
Authorization: Bearer YOUR_API_TOKEN
```

Or via query parameter (development only):
```
?api_token=YOUR_API_TOKEN
```

### Endpoints

#### List Products (Public)
```
GET /modules/addons/digitalproducts/api.php?endpoint=products
```

#### My Downloads (Auth Required)
```
GET /modules/addons/digitalproducts/api.php?endpoint=my-downloads
Authorization: Bearer {token}
```

#### Generate Download Link (Auth Required)
```
POST /modules/addons/digitalproducts/api.php?endpoint=download-link
Authorization: Bearer {token}
Content-Type: application/x-www-form-urlencoded

service_id=123&file_id=456
```

#### Validate License (Public)
```
POST /modules/addons/digitalproducts/api.php?endpoint=validate-license
Content-Type: application/x-www-form-urlencoded

license_key=DP-XXXX-XXXX-XXXX-XXXX&domain=example.com
```

#### Activate License (Public)
```
POST /modules/addons/digitalproducts/api.php?endpoint=activate-license
Content-Type: application/x-www-form-urlencoded

license_key=DP-XXXX-XXXX-XXXX-XXXX&domain=example.com
```

#### My Licenses (Auth Required)
```
GET /modules/addons/digitalproducts/api.php?endpoint=my-licenses
Authorization: Bearer {token}
```

## File Structure

```
modules/addons/digitalproducts/
├── digitalproducts.php              # Main module config & activation
├── digitalproducts_clientarea.php   # Client area entry point
├── hooks.php                        # WHMCS hooks integration
├── download.php                     # Secure download handler
├── api.php                          # REST API endpoint
├── lib/
│   ├── Core.php                     # Core functionality & database helpers
│   ├── Admin.php                    # Admin panel rendering
│   ├── Client.php                   # Client area rendering
│   └── License.php                  # License key management
├── templates/
│   └── client/
│       └── downloads.tpl            # Client area Smarty template
└── README.md                        # This file
```

## Database Schema

The module creates the following tables on activation:

### mod_digitalproducts_products
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Product ID |
| product_id | INT | Linked WHMCS product ID |
| product_name | VARCHAR | Display name |
| description | TEXT | Product description |
| status | ENUM | active/inactive/retired |
| current_file_id | INT | Currently active file |
| download_limit | INT | Max downloads per purchase |
| link_expiry_hours | INT | Download link validity |
| license_enabled | TINYINT | Enable license generation |

### mod_digitalproducts_files
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | File ID |
| product_id | INT | Parent product |
| version | VARCHAR | Version string |
| filename | VARCHAR | Stored filename |
| original_name | VARCHAR | Original upload name |
| file_path | VARCHAR | Full path on disk |
| file_hash | CHAR(64) | SHA-256 hash |
| file_size | BIGINT | File size in bytes |
| changelog | TEXT | Version notes |
| download_count | INT | Total downloads |
| status | ENUM | active/inactive |

### mod_digitalproducts_licenses
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | License ID |
| product_id | INT | Product reference |
| service_id | INT | WHMCS service ID |
| client_id | INT | Client ID |
| license_key | VARCHAR(64) | Unique license key |
| status | ENUM | active/suspended/expired/cancelled |
| domains | TEXT | JSON array of activated domains |
| activations_limit | INT | Max activations (0=unlimited) |
| activations_count | INT | Current activation count |
| expires_at | DATETIME | Expiration date |

### mod_digitalproducts_downloads
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Log ID |
| file_id | INT | Downloaded file |
| product_id | INT | Product reference |
| service_id | INT | Client's service |
| client_id | INT | Client ID |
| license_key | VARCHAR | License used |
| download_token | VARCHAR | Access token |
| ip_address | VARCHAR | Client IP |
| user_agent | TEXT | Browser info |
| status | ENUM | success/failed/expired/limit |

## Security Features

- Files stored outside web root (`/storage/digitalproducts/`)
- `.htaccess` protection on storage directory
- SHA-256 file hashing for integrity verification
- Token-based download links with configurable expiry
- Per-client download count enforcement
- Service ownership validation before every download
- Comprehensive IP and user agent logging
- No direct file URLs exposed to clients

## Hooks Used

| Hook | Purpose |
|------|---------|
| `OrderPaid` | Activate download access on payment |
| `AfterModuleCreate` | Generate license on service creation |
| `ClientAreaPrimarySidebar` | Add "My Downloads" navigation link |
| `DailyCronJob` | Clean old download logs |
| `AdminAreaHeadOutput` | Inject module CSS/JS |

## Troubleshooting

### Files not showing after upload
- Check storage directory permissions (should be writable by web server)
- Check WHMCS error logs
- Verify the product has a "current file" selected

### Downloads not working
- Ensure client service is "Active" in WHMCS
- Check if download limit has been reached
- Verify token hasn't expired (default 48h)
- Check PHP `memory_limit` for large files (chunked delivery handles most)

### License keys not generating
- Verify "Enable License Keys" is on in settings
- Check that the product has `license_enabled = true`
- Review OrderPaid hook is firing (check WHMCS Activity Log)

### Module causing slow admin
- The module only loads its assets on its own pages (via AdminAreaHeadOutput check)
- Download logs older than 90 days are auto-cleaned by cron

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024 | Initial release |

## Support

For support, please contact your module provider or create an issue in the repository.

## License

This module is provided as-is for use with your WHMCS installation. Modify as needed for your marketplace requirements.
