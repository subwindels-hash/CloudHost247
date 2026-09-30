# Security Model

## Authorization

Downloads require all of the following:

1. Valid secure token.
2. Token hash exists and is not expired, used beyond its limit or revoked.
3. Token belongs to a Digital Products entitlement.
4. Entitlement belongs to the same client/service/product binding.
5. WHMCS service still belongs to that client and is `Active`.
6. Digital Product is `active`.
7. Version/file is `active` and belongs to that Digital Product.
8. Download limit is not exceeded.
9. Private file exists and is readable.

If a customer is logged in and uses a token belonging to another client, access is denied.

## Tokens

- Generated with `bin2hex(random_bytes(32))`.
- Stored as SHA-256 hashes in `mod_digitalproducts_download_tokens`.
- Time-limited by product/global expiry settings.
- Single-use by default; configurable.
- Revoked when entitlements are suspended/revoked or when cron marks expired tokens revoked.

Raw tokens are not logged; download logs store a hash.

## File upload controls

Admin uploads validate:

- PHP upload status and real uploaded file checks.
- Extension allowlist.
- Maximum byte size.
- MIME type where `fileinfo` is available.
- Dangerous double extensions.
- Random private storage filename.
- SHA-256 checksum.
- ZIP path traversal, absolute paths, symlinks/special files, excessive entries and unsafe compression ratio where `ZipArchive` is available.

Uploaded files are never executed by the module and are always served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

## Storage

Use an outside-webroot storage path whenever possible. The module supports:

- `CH247_MODULE_STORAGE` environment variable.
- Addon setting **Private Storage Path**.
- Fallback `WHMCS_ROOT/storage/digitalproducts` with deny rules.

Storage keys are relative and path traversal is rejected.

## Admin security

- WHMCS admin authentication is required.
- WHMCS addon role permissions remain mandatory.
- CloudHost247 Foundation capability rows can further restrict actions.
- Admin POST operations use WHMCS CSRF token validation.
- Privileged events are written to CloudHost247 Foundation audit when available.

Capabilities include:

- `digitalproducts.products.view`
- `digitalproducts.products.manage`
- `digitalproducts.files.upload`
- `digitalproducts.files.delete`
- `digitalproducts.versions.manage`
- `digitalproducts.entitlements.manage`
- `digitalproducts.licenses.manage`
- `digitalproducts.downloads.view`
- `digitalproducts.settings.manage`
- `digitalproducts.audit.view`

## API security

- Customer data endpoints require a logged-in session or Bearer token.
- Query-string API tokens are not accepted.
- API tokens may be stored hashed in `api_token_hash`; legacy plaintext rows remain supported for migration.
- License validation/activation is rate-limited by IP.
- License failures use generic responses to reduce enumeration risk.
- No customer PII is returned from license validation.

## Logging

Download logs include client/service/product/version IDs, IP, user agent, status and failure reason. They do not store passwords, API secrets, encryption keys or raw download tokens.
