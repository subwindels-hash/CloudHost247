# Testing Checklist

Automated static checks live in `tests/digitalproducts/`.

Run without pytest:

```bash
python3 tests/digitalproducts/run.py
```

If pytest is available:

```bash
python3 -m pytest tests/digitalproducts -q
```

## Manual production acceptance tests

### Product and upload

- Link an existing WHMCS product.
- Edit metadata, type, status, access mode, download limit and token expiry.
- Upload a valid ZIP.
- Confirm checksum and randomized private storage path.
- Try invalid extension, traversal filename and oversized file.
- Retire a version and confirm no physical deletion occurs.

### Payment lifecycle

- Place and pay an order for the linked WHMCS product.
- Confirm one entitlement is created.
- Trigger the paid-order hook twice and confirm no duplicate entitlement/license.
- Suspend, unsuspend, terminate, cancel and refund; confirm access is recalculated and tokens are revoked.

### Customer downloads

- Log in as the customer and open **My Downloads**.
- Confirm product, version, purchase date, license, download count and checksum.
- Download successfully and confirm download logs and counters.
- Reuse a single-use token; confirm denial.
- Use another customer's session with the token; confirm denial.
- Hit the download limit; confirm denial and log status.

### License API

- Validate a valid active license.
- Validate invalid, suspended, expired and cancelled licenses.
- Activate a license domain.
- Try domain mismatch and activation limit exceedance.
- Exceed rate limit and confirm generic failure.

### Security

- Confirm direct private file URL is not available.
- Confirm admin POST without CSRF token is rejected.
- Confirm non-authorized admin capability is denied.
- Confirm API never accepts `?client_id=...` or `?api_token=...` as proof of ownership.
