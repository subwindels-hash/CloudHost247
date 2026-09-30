# Passkey test key material

These are **throwaway key pairs generated solely for the unit tests** in
`tests/passkey/run.php`. They let the suite build real WebAuthn ceremonies —
CBOR-encoded COSE keys, signed authenticator data — and verify them through
the same `CredentialVerifier` the production code uses, instead of stubbing
out the cryptography.

* They are not used by any runtime code path.
* They protect nothing and are safe to publish.
* `run.php` prefers `openssl_pkey_new()` when the PHP runtime can generate
  keys, and only falls back to these files when it cannot.

Regenerate at any time with:

```
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});console.log(k.privateKey.export({type:'pkcs8',format:'pem'}))"
```
