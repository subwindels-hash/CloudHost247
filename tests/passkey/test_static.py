#!/usr/bin/env python3
"""
CloudHost247 Passkey Authentication — static invariants.

No PHP runtime required. Mirrors tests/cart_recovery/test_static.py:
structure, security and "no fake data / no duplicate infrastructure"
guarantees that a behaviour test cannot easily assert.
"""
import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODULE = os.path.join(ROOT, "modules", "addons", "cloudhost247_passkey")
LIB = os.path.join(MODULE, "lib")


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def iter_sources(base):
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith((".php", ".tpl")):
                yield os.path.join(dirpath, name)


class PasskeyStaticTests(unittest.TestCase):
    # ---------------------------------------------------------------- structure
    def test_required_files_exist(self):
        required = [
            os.path.join(MODULE, "cloudhost247_passkey.php"),
            os.path.join(MODULE, "bootstrap.php"),
            os.path.join(MODULE, "hooks.php"),
            os.path.join(MODULE, "api.php"),
            os.path.join(MODULE, "README.md"),
            os.path.join(MODULE, "migrations", "V100.php"),
            os.path.join(MODULE, "templates", "admin", "index.tpl"),
            os.path.join(MODULE, "templates", "client", "security.tpl"),
            os.path.join(MODULE, "templates", "client", "login.tpl"),
            os.path.join(MODULE, "assets", "passkey.js"),
            os.path.join(MODULE, "assets", "passkey.css"),
            os.path.join(ROOT, "crons", "cloudhost247_passkey.php"),
            os.path.join(ROOT, "docs", "PASSKEY.md"),
        ]
        for path in required:
            self.assertTrue(os.path.isfile(path), path)

    def test_addon_entry_points_are_declared(self):
        text = read(os.path.join(MODULE, "cloudhost247_passkey.php"))
        for hook in ("_config", "_activate", "_deactivate", "_upgrade", "_output"):
            self.assertIn("function cloudhost247_passkey" + hook, text)

    def test_no_composer_dependency_is_introduced(self):
        self.assertFalse(os.path.exists(os.path.join(MODULE, "composer.json")))
        self.assertFalse(os.path.exists(os.path.join(MODULE, "vendor")))
        for path in iter_sources(MODULE):
            self.assertNotIn("vendor/autoload.php", read(path), path)

    def test_tables_follow_the_repository_namespace(self):
        text = read(os.path.join(LIB, "Schema.php"))
        names = re.findall(r"'(mod_[a-z0-9_]+)'", text)
        self.assertTrue(names)
        for name in names:
            self.assertTrue(name.startswith("mod_cloudhost247_passkey_"), name)

    # ----------------------------------------------------------------- secrets
    def test_no_private_key_or_biometric_storage(self):
        """The schema must have nowhere to put a private key or biometric."""
        migration = read(os.path.join(MODULE, "migrations", "V100.php"))
        columns = re.findall(r"\$table->\w+\(\s*'([a-z0-9_]+)'", migration)
        self.assertIn("public_key", columns)
        for column in columns:
            for forbidden in ("private", "biometric", "fingerprint", "device_pin", "secret"):
                self.assertNotIn(forbidden, column, column)

    def test_no_embedded_key_material_or_credentials(self):
        bad = re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}")
        for path in iter_sources(MODULE):
            self.assertIsNone(bad.search(read(path)), path)

    def test_no_command_execution_or_unsafe_deserialization(self):
        bad = re.compile(r"\b(eval|exec|shell_exec|system|passthru|proc_open|popen|unserialize)\s*\(", re.I)
        for path in iter_sources(MODULE):
            self.assertIsNone(bad.search(read(path)), path)

    def test_secrets_are_encrypted_before_storage(self):
        settings = read(os.path.join(LIB, "SettingsRepository.php"))
        self.assertIn("secretKeys", settings)
        self.assertIn("Crypto::encrypt", settings)
        self.assertIn("Crypto::decrypt", settings)
        # all() must mask, never return, a stored secret
        self.assertIn("'********'", settings)

    def test_crypto_has_no_plaintext_fallback(self):
        crypto = read(os.path.join(LIB, "Crypto.php"))
        self.assertIn("ConfigurationException", crypto)
        self.assertIn("aes-256-gcm", crypto)

    def test_log_scrubbing_covers_every_ceremony_field(self):
        log = read(os.path.join(LIB, "Log.php")).lower()
        for field in ("challenge", "signature", "credential", "clientdatajson",
                      "attestationobject", "authenticatordata", "private_key", "token"):
            self.assertIn(field, log)

    # ------------------------------------------------------------- ceremonies
    def test_verifier_performs_every_required_check(self):
        verifier = read(os.path.join(LIB, "CredentialVerifier.php"))
        for marker in ("webauthn.create", "webauthn.get", "hash_equals",
                       "rpid_mismatch", "origin_mismatch", "FLAG_USER_PRESENT",
                       "FLAG_USER_VERIFIED", "counter_replay", "crossOrigin",
                       "openssl_verify"):
            self.assertIn(marker, verifier)

    def test_challenges_are_csprng_single_use_and_session_bound(self):
        repository = read(os.path.join(LIB, "ChallengeRepository.php"))
        self.assertIn("random_bytes(32)", repository)
        self.assertIn("consumed_at", repository)
        self.assertIn("challenge_replay", repository)
        self.assertIn("session_mismatch", repository)
        self.assertNotIn("mt_rand", repository)
        self.assertNotIn("uniqid", repository)

    def test_no_weak_randomness_anywhere(self):
        bad = re.compile(r"\b(mt_rand|rand|uniqid|shuffle|str_shuffle)\s*\(")
        for path in iter_sources(MODULE):
            self.assertIsNone(bad.search(read(path)), path)

    def test_registration_requests_no_attestation(self):
        registration = read(os.path.join(LIB, "RegistrationService.php"))
        self.assertIn("'attestation' => 'none'", registration)

    def test_eddsa_is_rejected_rather_than_silently_accepted(self):
        cose = read(os.path.join(LIB, "Cose.php"))
        self.assertIn("ALG_EDDSA", cose)
        self.assertIn("unsupported_algorithm", cose)

    # ----------------------------------------------------------------- access
    def test_admin_controller_enforces_auth_and_csrf(self):
        controller = read(os.path.join(LIB, "AdminController.php"))
        self.assertIn("requireAdmin()", controller)
        self.assertIn("requirePostToken()", controller)
        self.assertIn("checkPermission", controller)

    def test_admin_views_never_expose_key_material(self):
        for path in (os.path.join(MODULE, "templates", "admin", "index.tpl"),
                     os.path.join(LIB, "AdminController.php")):
            text = read(path)
            self.assertNotIn("public_key", text, path)
            self.assertNotIn("['credential_id']", text.replace(
                "$post['credential_id']", ""), path)
        # The admin list is built from the sanitised DTO, not from raw rows.
        self.assertIn("toPublicArray", read(os.path.join(LIB, "AdminController.php")))

    def test_api_endpoint_is_hardened(self):
        api = read(os.path.join(MODULE, "api.php"))
        for marker in ("REQUEST_METHOD", "csrf_failed", "hash_equals",
                       "HTTP_ORIGIN", "X-Frame-Options", "no-store",
                       "nosniff", "not_authenticated"):
            self.assertIn(marker, api)
        # Unexpected exceptions become a generic body; only curated
        # PasskeyException messages are ever shown to the user.
        self.assertIn("'server_error'", api)
        self.assertIn("Log::safeError($e)", api)
        self.assertNotIn("$e->getTraceAsString", api)

    def test_ownership_is_enforced_for_credential_management(self):
        api = read(os.path.join(MODULE, "api.php"))
        self.assertEqual(api.count("findOwned("), 2)

    def test_cron_entry_is_cli_only(self):
        cron = read(os.path.join(ROOT, "crons", "cloudhost247_passkey.php"))
        self.assertIn("PHP_SAPI", cron)

    def test_public_entry_points_refuse_direct_access(self):
        for name in ("bootstrap.php", "hooks.php", "cloudhost247_passkey.php"):
            self.assertIn("Direct access denied", read(os.path.join(MODULE, name)))

    # ------------------------------------------------------------ fail-closed
    def test_configuration_is_explicit_and_fails_closed(self):
        config = read(os.path.join(LIB, "Config.php"))
        self.assertIn("ConfigurationException", config)
        # The relying party comes from settings, never from the request.
        relying_party = config.split("public static function relyingParty")[1]
        relying_party = relying_party.split("public static function")[0]
        self.assertNotIn("$_SERVER", relying_party)
        self.assertIn("SettingsRepository::get('rp_id'", relying_party)
        defaults = read(os.path.join(LIB, "SettingsRepository.php"))
        self.assertIn("'rp_id' => ''", defaults)
        self.assertIn("'allowed_origins' => ''", defaults)

    def test_enforcement_cannot_lock_out_unenrolled_accounts(self):
        policy = read(os.path.join(LIB, "PolicyService.php"))
        self.assertIn("enrollment_pending", policy)
        self.assertIn("emergency_override", policy)
        self.assertIn("configuration_required", policy)

    def test_lockouts_are_always_temporary(self):
        limiter = read(os.path.join(LIB, "RateLimiter.php"))
        self.assertIn("locked_until", limiter)
        # Every lockout is written with an explicit expiry timestamp.
        self.assertIn("$now + $lockout", limiter)
        self.assertNotIn("'locked' => 1", limiter)

    # --------------------------------------------------------------- frontend
    def test_client_assets_degrade_gracefully(self):
        script = read(os.path.join(MODULE, "assets", "passkey.js"))
        self.assertIn("PublicKeyCredential", script)
        self.assertIn("data-passkey-unsupported", script)
        self.assertIn("NotAllowedError", script)
        login = read(os.path.join(MODULE, "templates", "client", "login.tpl"))
        # The passkey block must be additive, never a replacement.
        self.assertIn("data-passkey-only", login)

    def test_migration_is_additive_only(self):
        migration = read(os.path.join(MODULE, "migrations", "V100.php"))
        self.assertIsNone(re.search(r"->(drop|dropIfExists|rename)\s*\(", migration))
        self.assertEqual(
            migration.count("->create("),
            len(re.findall(r"hasTable\(", migration)),
        )


if __name__ == "__main__":
    unittest.main()
