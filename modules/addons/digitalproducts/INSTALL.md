# Installation

## Requirements

- WHMCS 8.x
- PHP 7.4–8.2
- PDO/MySQL through WHMCS Capsule
- OpenSSL / `random_bytes`
- `fileinfo` recommended for MIME validation
- `ZipArchive` recommended for ZIP security inspection
- CloudHost247 Foundation addon available in `modules/addons/cloudhost247_core/`

## Activate

1. Upload or deploy this repository to the WHMCS installation.
2. In WHMCS Admin, activate **CloudHost247 Foundation** first if it is not already active.
3. Activate **CloudHost247 Digital Products Marketplace**.
4. Review the activation message for migration status and storage warnings.
5. Configure WHMCS addon-role access and optional CloudHost247 Foundation capabilities.

## Configure private storage

Preferred production storage is outside the webroot.

Set one of the following:

1. Environment variable:

```bash
CH247_MODULE_STORAGE=/home/cloudhost247/private-storage
```

Digital products will use:

```text
/home/cloudhost247/private-storage/digital-products/
```

2. Or set **Private Storage Path** in addon settings.

If neither is set, the module uses:

```text
WHMCS_ROOT/storage/digitalproducts/
```

The module writes `.htaccess` and `index.html` protection files, but an outside-webroot path is strongly recommended.

## Configure defaults

Open **Addons → CloudHost247 Digital Products Marketplace → Settings** and review:

- Default download limit (`0` = unlimited)
- Default token expiry hours
- Default access mode (`CURRENT_VERSION` or `PURCHASE_VERSION`)
- Allowed upload extensions
- Maximum upload size
- Single-use tokens
- Email delivery
- Update notifications
- API rate limit

## First product setup

1. Create a normal WHMCS product.
2. In the addon, open **Products** and link the WHMCS product.
3. Edit the Digital Product and set status to `active` when ready.
4. Upload version `1.0.0` from **Upload File**.
5. Check **Set as current version**.
6. Place and pay a test order.
7. Confirm the entitlement, license, email, client-area listing and secure download log.
