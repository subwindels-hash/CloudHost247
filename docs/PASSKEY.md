# Passkey / WebAuthn security model

Reference documentation for `modules/addons/cloudhost247_passkey`. The README
in that module covers installation and day-to-day operation; this document
covers the security decisions, the threat model and the bits an auditor will
want to check.

---

## 1. Design principles

1. **The private key never exists on our side.** Registration stores a public
   key and nothing else. There is no code path, and no database column, that
   could persist a private key, a biometric template or a device PIN.
2. **Fail closed, never fail open.** If the relying party is unconfigured, if
   OpenSSL is missing, or if any structural check fails, the ceremony is
   refused. The fallback is the existing WHMCS password login — never a
   weakened passkey path.
3. **Nobody gets locked out by our bugs.** Enforcement is suspended for
   accounts with no enrolled passkey, suspended when configuration is broken,
   and can be suspended entirely with a filesystem break-glass file.
4. **No new dependencies.** Cryptography is PHP OpenSSL. CBOR/COSE code is
   parsing and DER encoding only.
5. **Additive to the existing architecture.** Same autoloader, migration,
   settings, logging and admin-controller conventions as the other
   `cloudhost247_*` addons. Nothing existing is modified or duplicated.

## 2. Table naming

The functional specification names the credential store `cloudhost247_passkeys`.
The repository convention — enforced by `scripts/validate-migrations.py` — is
that every module table begins with `mod_cloudhost247_`. The mapping is:

| Specification | Actual table |
| --- | --- |
| `cloudhost247_passkeys` | `mod_cloudhost247_passkey_credentials` |
| challenge store | `mod_cloudhost247_passkey_challenges` |
| security activity log | `mod_cloudhost247_passkey_events` |
| enforcement overrides | `mod_cloudhost247_passkey_policies` |
| federated identity links | `mod_cloudhost247_passkey_identities` |
| throttling state | `mod_cloudhost247_passkey_rate_limits` |
| module settings | `mod_cloudhost247_passkey_settings` |

Application code always refers to these through the constants in
`lib/Schema.php`; the literal names appear only in `migrations/V100.php`.

## 3. Registration ceremony

`RegistrationService::options()` issues:

* a **32-byte CSPRNG challenge** (`random_bytes`), stored server-side,
  single-use, bound to the user, the ceremony type and the browser session;
* `attestation: "none"` — the recommended setting for passkeys;
* `excludeCredentials` for everything already enrolled;
* an opaque **user handle**: `base64url(SHA-256("…user:" ‖ type ‖ id))`. It is
  stable, non-reversible and carries no PII, because WebAuthn user handles
  must not contain personal data.

`RegistrationService::verify()` consumes the challenge **before** verifying,
then `CredentialVerifier::verifyRegistration()` checks:

* `clientDataJSON.type === "webauthn.create"` (exact match);
* challenge equality with `hash_equals` (constant time);
* origin against the explicit allow-list (never a wildcard, never the Host
  header);
* `crossOrigin !== true`;
* `SHA-256(rpId)` equals the RP ID hash inside authenticator data;
* the User Present flag, and User Verified when policy requires it;
* attested credential data is present and well formed;
* the COSE algorithm is one of ES256 / ES384 / RS256.

The public key is taken **only** from authenticator data, never from the
attestation statement. Because attestation is `none`, no certificate chain is
validated — the credential is trusted on the strength of the signature it
produces, which is the standard passkey posture.

### Unsupported algorithms

EdDSA (`-8`) is **rejected with a clear error** rather than silently accepted:
PHP's OpenSSL binding cannot verify Ed25519 on every supported PHP version,
and pretending to verify would be a security bug. RSA moduli below 2048 bits
are rejected outright.

## 4. Authentication ceremony

Both flows are supported:

* **Discoverable (usernameless)** — no `allowCredentials`; the authenticator
  returns a user handle, which must match the stored credential's owner.
* **Identifier-first** — the caller names an account and receives its
  credential list.

`AuthenticationService::verify()` additionally enforces:

* the credential exists, is `active`, and belongs to the account the challenge
  was issued for (when it was issued for one);
* the account itself is not closed or disabled;
* the assertion signature verifies over `authenticatorData ‖ SHA-256(clientDataJSON)`;
* **signature-counter monotonicity**. A counter that fails to increase is
  treated as a possible cloned authenticator: the credential is disabled and
  the user is notified. Authenticators that do not implement a counter always
  report `0`, so the check is skipped when both the stored and reported
  counters are `0` — otherwise every such authenticator would be permanently
  rejected.

### Enumeration resistance

`auth_options` and `reset_options` return a well-formed challenge with an
empty credential list for unknown accounts. The response shape, field set and
challenge length are identical to a known account, so the endpoint cannot be
used to discover which email addresses exist.

## 5. Challenge handling

| Property | Implementation |
| --- | --- |
| Entropy | 32 bytes from `random_bytes()` |
| Lookup | by SHA-256 of the challenge, never by the raw value |
| Single use | `consumed_at` set in a conditional `UPDATE … WHERE consumed_at IS NULL`, which also resolves concurrent-request races |
| Lifetime | 120 s default for sign-in, 90 s for action confirmation, both clamped to 30–600 s |
| Binding | ceremony type, user (when known), action (when applicable), and a hash of the PHP session id |

Consumption happens **before** signature verification, so a failed attempt can
never be retried with a corrected payload.

## 6. Sensitive action confirmation

A confirmation is a full assertion bound to one named action from a fixed
allow-list (`ActionConfirmationService::actions()`). On success it mints a
single-use, short-lived, session-bound authorization token. `consume()`
returns `true` exactly once, and only for the same user **and** the same
action — a confirmation obtained for "add a contact" cannot authorise "change
the account email".

## 7. Password reset

Three steps: `options()` → `verify()` → `complete()`.

* User verification is **always required** for a reset, regardless of the
  global login setting: the passkey alone proves possession, a reset needs
  possession *and* the user.
* The authorization is never emailed and never appears in a URL.
* The new password must be ≥ 12 characters and mix at least three character
  classes. WHMCS may apply stricter rules on top; this is a floor.
* The write goes through the supported `UpdateClient` API so hashing, history
  and hooks behave exactly as in a normal password change.
* Administrator passwords are **not** resettable this way — WHMCS exposes no
  supported API, and a direct write could not be guaranteed to hash
  identically.

## 8. Rate limiting and lockout

Failures are counted per `(bucket, hashed subject)` inside a sliding window.
Crossing the threshold sets `locked_until`. Lockouts are always temporary and
always carry an explicit expiry timestamp; a successful ceremony clears the
counter immediately. Subjects (emails, IPs, user ids) are stored hashed.

## 9. Transport hardening (`api.php`)

* POST only, JSON only, body capped at 64 KiB.
* `Origin` must be in the configured allow-list when present.
* Session-bound double-submit CSRF token for every state-changing and
  session-acting action. The unauthenticated ceremonies (`auth_*`, `reset_*`)
  are exempt by necessity and are protected instead by the server-issued
  challenge and the origin check.
* `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
* Error bodies carry a stable machine reason plus a curated message. Internal
  exception text and stack traces are logged, never returned.

## 10. Logging

Two layers:

* `mod_cloudhost247_passkey_events` — the append-only security activity log
  shown in the admin UI and used for retention.
* The Foundation `Logger` via `lib/Log.php`.

Both pass metadata through `Log::scrub()`, which redacts any key containing
`password`, `secret`, `token`, `private_key`, `signature`, `challenge`,
`assertion`, `credential`, `clientdatajson`, `attestationobject`,
`authenticatordata` or `code`, and truncates long strings. A behaviour test
asserts that no ceremony payload field name ever reaches the log.

## 11. Secret storage

The only secret this addon stores is the optional Entra ID client secret. It
is encrypted with WHMCS's own encryption helper when available, otherwise with
AES-256-GCM keyed from the installation's encryption hash. **There is no
plaintext fallback** — if no encryption facility exists, saving the secret
fails with `CONFIGURATION_REQUIRED`. `SettingsRepository::all()` masks it as
`********`; only `secret()` decrypts it, for the one service that needs it.

## 12. Microsoft Entra ID (optional, disabled by default)

Authorization-code flow with PKCE (S256). State and nonce are single-use and
session-bound. The `id_token` is received over a TLS-verified back channel
directly from Microsoft's token endpoint — the OIDC-sanctioned reason
signature validation is not mandatory — and its issuer, audience, expiry,
issued-at and nonce are all checked. The account link is keyed on the
immutable `oid` claim, never on the email address or UPN, both of which are
mutable and re-assignable. Auto-linking only ever matches an **existing**
account; it never creates one. Tokens are used in-request and never persisted.

## 13. Optional delegation to `web-auth/webauthn-lib`

If a future WHMCS installation already ships `web-auth/webauthn-lib` in its
own vendor tree, the verification step in `lib/CredentialVerifier.php` is the
single seam where it could be delegated. The addon deliberately does **not**
require it: adding a Composer dependency to a WHMCS installation is a
deployment hazard, and the verification surface here is small, fully tested
and dependency-free.

## 14. Test coverage

`php tests/passkey/run.php` runs 50+ behaviour tests against real
cryptography, including: challenge replay, cross-session challenge reuse,
expired challenges, tampered signatures, foreign origins, wrong RP ID, missing
user presence, wrong ceremony type, cloned-authenticator detection, revoked
credentials, closed accounts, user-handle mismatch, enumeration resistance,
credential-limit enforcement, IDOR across accounts, CSRF on admin actions,
lockout expiry, policy lock-out safety, single-use action confirmations,
single-use reset authorizations, secret masking, and log scrubbing.

`python3 -m unittest tests/passkey/test_static.py` enforces the structural
invariants: no Composer, no private-key column, no weak randomness, no
command execution, RP configuration never inferred from the request, the
admin controller's auth + CSRF guards, and the additive-only migration.
