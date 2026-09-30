# Passkey test key material

`tests/passkey/run.php` builds **real** WebAuthn ceremonies: it CBOR-encodes a
COSE public key and signs authenticator data, then verifies the result through
the production `CredentialVerifier`. To do that it needs a P-256 key pair.

The suite obtains one by:

1. **generating a fresh key** with `openssl_pkey_new()` — this is what CI and
   any normal PHP runtime do, so nothing in this directory is needed there; or
2. **reusing a cached key** written to `es256-private.test.pem` by a previous
   successful run.

The cache exists only for runtimes that cannot generate keys (php-wasm, for
example, has no `openssl.cnf`). It is **not committed** — the repository's
`.gitignore` excludes `*.pem`, and a private key does not belong in version
control even when it protects nothing.

If neither path works, the suite fails with an explicit message rather than a
confusing type error. Create the key manually with:

```
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out tests/passkey/fixtures/es256-private.test.pem
```

The key is throwaway, is used by no runtime code path, and is safe to delete
at any time.
