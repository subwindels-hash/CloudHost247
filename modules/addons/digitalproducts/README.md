# CloudHost247 Digital Products Marketplace

Native CloudHost247 / WHMCS 8.x addon for selling downloadable products linked to real WHMCS products and services. This implementation upgrades the existing `modules/addons/digitalproducts/` module in-place; it does **not** create a duplicate marketplace or a second WHMCS product system.

## What changed in the production hardening rebuild

- Preserves the legacy tables and `mod_digitalproducts_files` data model while adding missing production columns and tables non-destructively.
- Adds customer entitlement tracking with idempotent WHMCS order/service hooks.
- Replaces session-only download links with hashed, expiring download tokens in `mod_digitalproducts_download_tokens`.
- Stores downloads in private local storage via a storage abstraction (`LocalPrivateStorage`) with `CH247_MODULE_STORAGE` support.
- Adds upload validation: extension allowlist, size checks, MIME checks, safe filenames, ZIP traversal/symlink/zip-bomb inspection, SHA-256 checksums and randomized storage names.
- Adds optional hashed/encrypted license keys and rate-limited validation/activation API endpoints.
- Adds CloudHost247 Foundation capability checks, CSRF protection on admin POST operations and Foundation audit logging where available.
- Adds lifecycle hooks for paid orders, provisioning, suspension, unsuspension, termination, cancellation and refunds.
- Improves the CloudHost247 client-area “My Downloads” experience with responsive cards, details, release history and checksums.

## Core workflows

### Administrator

1. Create a normal WHMCS product in `tblproducts`.
2. Open **Addons → CloudHost247 Digital Products Marketplace**.
3. Link the WHMCS product as a Digital Product.
4. Upload a versioned file.
5. Set the version current and set product status to `active`.
6. Review entitlements, licenses, download logs and audit events from the addon dashboard.

### Customer

1. Purchase the WHMCS product through the normal cart and payment gateway flow.
2. WHMCS marks the order/service paid/active.
3. Digital Products creates or updates an entitlement idempotently.
4. A license is generated when enabled.
5. The customer receives a WHMCS email containing a secure, time-limited download link.
6. The customer can always download from **Client Area → My Downloads** while the entitlement and WHMCS service remain valid.

## Important security model

- WHMCS remains the source of truth for products, clients, orders and services.
- A Digital Product references the WHMCS product ID; it never duplicates the WHMCS product.
- Download authorization checks the entitlement, WHMCS service ownership/state, product status, version status, token validity and download limits.
- Download tokens are generated from `random_bytes(32)` and stored as SHA-256 hashes.
- Direct physical file paths are never rendered to customers.
- New files are stored under randomized names in private storage.
- New license validation uses `license_hash`; legacy plaintext license rows remain supported for upgrade compatibility.

## Documentation

- [AUDIT.md](AUDIT.md) — findings from the existing-module audit and remediation map.
- [INSTALL.md](INSTALL.md) — installation and activation.
- [UPGRADE.md](UPGRADE.md) — safe upgrades from the original module.
- [SECURITY.md](SECURITY.md) — security controls and operational guidance.
- [API.md](API.md) — JSON API and license validation examples.
- [DATABASE.md](DATABASE.md) — schema, compatibility and migrations.
- [TESTING.md](TESTING.md) — automated static checks and manual acceptance checklist.

## Final folder structure

```text
modules/addons/digitalproducts/
├── api.php
├── bootstrap.php
├── digitalproducts.php
├── digitalproducts_clientarea.php
├── download.php
├── hooks.php
├── migrations/
│   └── V100.php
├── lib/
│   ├── Admin.php
│   ├── Client.php
│   ├── Core.php
│   ├── License.php
│   ├── Security/
│   ├── Services/
│   ├── Storage/
│   └── Support/
└── templates/client/downloads.tpl
```

## No demo data

The addon does not create products, purchases, customers, files, licenses or prices. It uses real WHMCS products/services and explicit administrator uploads only.
