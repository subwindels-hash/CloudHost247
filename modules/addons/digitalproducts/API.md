# Digital Products API

Base path:

```text
/modules/addons/digitalproducts/api.php
```

Responses are JSON. Use HTTPS in production.

## Authentication

Customer endpoints accept either:

- Existing WHMCS client session, or
- `Authorization: Bearer <api_token>` header.

Query-string API tokens are intentionally not supported.

API token rows live in `mod_digitalproducts_api_tokens`. New deployments should store SHA-256 in `api_token_hash`; legacy `api_token` rows are still accepted for upgrade compatibility.

## Public endpoints

### GET products

```http
GET /modules/addons/digitalproducts/api.php?endpoint=products
```

Returns active Digital Products with a current version.

### GET product

```http
GET /modules/addons/digitalproducts/api.php?endpoint=product&id=12
GET /modules/addons/digitalproducts/api.php?endpoint=product&slug=my-product
```

### GET versions

```http
GET /modules/addons/digitalproducts/api.php?endpoint=versions&product_id=12
```

Returns active versions, checksums and compatibility fields.

## Authenticated customer endpoints

### GET my-downloads

```http
GET /modules/addons/digitalproducts/api.php?endpoint=my-downloads
Authorization: Bearer <token>
```

Returns the authenticated customer’s active entitlements and current downloadable version metadata.

### POST generate-download-token

```http
POST /modules/addons/digitalproducts/api.php?endpoint=generate-download-token
Authorization: Bearer <token>
Content-Type: application/x-www-form-urlencoded

service_id=123&file_id=456
```

`file_id` is optional. If supplied, it must match the version allowed by the product access policy.

Response:

```json
{
  "status": "success",
  "data": {
    "download_url": "https://example.com/modules/addons/digitalproducts/download.php?token=...",
    "expires_at": "2026-10-02 12:00:00"
  }
}
```

### GET license

```http
GET /modules/addons/digitalproducts/api.php?endpoint=license&service_id=123
Authorization: Bearer <token>
```

### GET my-licenses

```http
GET /modules/addons/digitalproducts/api.php?endpoint=my-licenses
Authorization: Bearer <token>
```

## License validation endpoints

These endpoints are intentionally generic on failure and rate-limited per IP.

### POST validate-license

```http
POST /modules/addons/digitalproducts/api.php?endpoint=validate-license
Content-Type: application/x-www-form-urlencoded

license_key=CH247-ABCD-EFGH-IJKL-MNOP&domain=example.com&product=my-product
```

Success:

```json
{
  "valid": true,
  "status": "active",
  "product": "CloudHost247 Module Pro",
  "expires_at": null
}
```

Failure:

```json
{
  "valid": false,
  "status": "invalid"
}
```

### POST activate-license

```http
POST /modules/addons/digitalproducts/api.php?endpoint=activate-license
Content-Type: application/x-www-form-urlencoded

license_key=CH247-ABCD-EFGH-IJKL-MNOP&domain=example.com
```

Success:

```json
{
  "success": true,
  "status": "active"
}
```
