# CloudHost247 Passkey Authentication

Passwordless sign-in for the WHMCS client area and admin area using
**WebAuthn / FIDO2 passkeys**, plus passkey confirmation for sensitive
actions, passkey-based password reset, and an optional Microsoft Entra ID
link.

WHMCS stays the source of truth for accounts, sessions and permissions. This
addon proves *who* the user is; it never replaces the WHMCS login pipeline and
never touches the existing password, 2FA or session machinery.

---

## What is stored (and what is not)

| Stored | Never stored |
| --- | --- |
| Credential ID, **public** key, COSE algorithm | Private keys (they stay on the authenticator) |
| Signature counter, transports, AAGUID | Biometric data of any kind |
| Friendly device name, timestamps, status | Face ID / Touch ID / Windows Hello secrets |
| Registration IP and user agent | Device PINs or screen-lock codes |

The database schema has no column that could hold any of the right-hand
column — see `migrations/V100.php`, and the static test that enforces it in
`tests/passkey/test_static.py`.

## Installation

1. Copy the module to `modules/addons/cloudhost247_passkey/`.
2. Activate **CloudHost247 Passkey Authentication** under
   *Setup → Addon Modules*. Activation runs the migrations and seeds defaults.
3. Open the addon and complete the **Settings → Relying party** section:
   * **RP ID** — your registrable domain, e.g. `example.com`.
   * **Allowed origins** — one absolute HTTPS origin per line, e.g.
     `https://portal.example.com`.

   Until both are set the addon **fails closed**: every ceremony is refused
   with `CONFIGURATION_REQUIRED` and the client area keeps using the standard
   password login. Nothing is guessed from the request host.
4. Add the housekeeping cron (hourly):

   ```
   0 * * * * php -q /path/to/whmcs/crons/cloudhost247_passkey.php
   ```

   The same work also runs from the `AfterCronJob` hook, so this is optional
   but recommended.
5. Add the two client-area includes to your active theme:

   ```smarty
   {* templates/<theme>/login.tpl *}
   {include file="$template/../../modules/addons/cloudhost247_passkey/templates/client/login.tpl"}

   {* templates/<theme>/clientareasecurity.tpl *}
   {include file="$template/../../modules/addons/cloudhost247_passkey/templates/client/security.tpl"}
   ```

> **Changing the RP ID invalidates every registered passkey.** Passkeys are
> permanently bound to the domain they were created for. Pick the RP ID before
> rolling out, and keep it.

## Admin screens

* **Overview** — enrolment and sign-in counters, plus on-demand housekeeping.
* **Passkeys** — every registered credential (metadata only) with disable,
  enable and revoke actions, and per-account policy overrides.
* **Activity** — the filtered security log.
* **Settings** — relying party, policy, hardening, features, Entra ID.
* **Diagnostics** — a pass/attention list explaining exactly why passkeys are
  or are not usable on this installation.

Administrators never see a public key, a challenge or a signature anywhere in
the UI or the API.

## Policy and lock-out safety

Enforcement can be *optional*, *selected* or *all*, globally and per account.
Three rules are hard-coded and cannot be configured away:

1. Enforcement never applies to an account with **no enrolled passkey** — such
   accounts are prompted to enrol, never refused.
2. If the relying-party configuration is broken, enforcement is suspended and
   password fallback is restored.
3. A **break-glass override** exists: create a file named
   `cloudhost247_passkey_emergency_override` in the WHMCS root. It suspends
   enforcement and expires by itself 24 hours after its mtime. It requires
   filesystem access, so no HTTP request can trigger it.

Rate limiting produces **temporary** lockouts only, with an explicit expiry.

## Endpoints

Everything goes through one JSON endpoint,
`modules/addons/cloudhost247_passkey/api.php` (POST only), which enforces
same-origin, a session-bound double-submit CSRF token, a bounded body size,
no-store/no-frame headers and generic error bodies.

| Action | Purpose |
| --- | --- |
| `register_options` / `register_verify` | Enrol a new passkey |
| `auth_options` / `auth_verify` | Sign in (discoverable or identifier-first) |
| `action_options` / `action_verify` | Confirm a sensitive action |
| `reset_options` / `reset_verify` / `reset_complete` | Password reset with a passkey |
| `list_credentials` / `rename_credential` / `revoke_credential` | Self-service management |
| `status` | Enrolment and policy state |

## Front-end API

`assets/passkey.js` exposes `window.CloudHost247Passkey` with
`supported()`, `register()`, `authenticate()`, `confirm(action)`,
`resetPassword()`, `list()`, `rename()`, `revoke()` and `status()`. All UI is
progressive enhancement: without WebAuthn the controls never appear and the
password form is untouched.

To gate your own feature behind a passkey:

```js
const token = await CloudHost247Passkey.confirm('payment_method_add');
// send `token` with your request; the server calls
// ActionConfirmationService::consume($token, $userType, $userId, 'payment_method_add')
```

## Dependencies

**None.** No Composer package is added. Signature verification uses PHP's
OpenSSL extension; the CBOR and COSE code in `lib/` performs structural
parsing and DER encoding only.

## Tests

```
php tests/passkey/run.php
python3 -m unittest tests/passkey/test_static.py
python3 scripts/validate-migrations.py
```

The behaviour suite builds **real** WebAuthn ceremonies — CBOR-encoded COSE
keys signed with OpenSSL — and verifies them through the production
`CredentialVerifier`. See `docs/PASSKEY.md` for the full security model.
