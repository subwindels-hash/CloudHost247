<?php
/**
 * CloudHost247 Passkey — autoloader bootstrap.
 *
 * Mirrors the loader convention used by the other CloudHost247 addons (see
 * modules/addons/cloudhost247_cart_recovery/bootstrap.php): a small PSR-4
 * style autoloader over lib/ plus the versioned migration classes.
 *
 * No Composer dependency is introduced by this addon. WebAuthn assertion and
 * attestation signatures are verified with PHP's OpenSSL extension (a mature,
 * audited cryptographic implementation) — no cryptography is hand-rolled here;
 * only structural decoding (CBOR/COSE/DER encoding) is implemented locally,
 * because that is parsing, not cryptography. If a WHMCS installation already
 * ships web-auth/webauthn-lib in its own vendor tree, see docs/PASSKEY.md for
 * the documented, optional delegation path.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

spl_autoload_register(function ($class) {
    $prefix = 'CloudHost247\\Passkey\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    if (strncmp($relative, 'Migrations\\', 11) === 0) {
        $file = __DIR__ . '/migrations/' . str_replace('\\', '/', substr($relative, 11)) . '.php';
    } else {
        $file = __DIR__ . '/lib/' . str_replace('\\', '/', $relative) . '.php';
    }
    if (is_file($file)) {
        require_once $file;
    }
});
