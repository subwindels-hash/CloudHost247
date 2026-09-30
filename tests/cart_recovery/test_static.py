#!/usr/bin/env python3
"""
CloudHost247 Cart Recovery — static invariants.

No PHP runtime required. Mirrors tests/marketing/test_static.py philosophy:
structure, security and "no fake data / no duplicate infrastructure"
guarantees that a behaviour test cannot easily assert.
"""
import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODULE = os.path.join(ROOT, "modules", "addons", "cloudhost247_cart_recovery")
LIB = os.path.join(MODULE, "lib")


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def iter_sources(base):
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith((".php", ".tpl")):
                yield os.path.join(dirpath, name)


class CartRecoveryStaticTests(unittest.TestCase):
    # -------------------------------------------------------------- structure
    def test_required_files_exist(self):
        required = [
            os.path.join(MODULE, "cloudhost247_cart_recovery.php"),
            os.path.join(MODULE, "bootstrap.php"),
            os.path.join(MODULE, "hooks.php"),
            os.path.join(MODULE, "cron.php"),
            os.path.join(MODULE, "recover.php"),
            os.path.join(MODULE, "README.md"),
            os.path.join(MODULE, "migrations", "V100.php"),
            os.path.join(MODULE, "migrations", "V101.php"),
            os.path.join(MODULE, "templates", "admin", "index.tpl"),
            os.path.join(ROOT, "tests", "cart_recovery", "run.php"),
            os.path.join(ROOT, "tests", "cart_recovery", "fakes.php"),
        ]
        for name in (
            "RecoveryService", "CartSnapshot", "ReminderService", "TokenService",
            "EmailService", "SettingsRepository", "MigrationRunner", "AdminController",
            "Analytics", "Schema", "Lock", "Log", "OrderRevenue",
        ):
            required.append(os.path.join(LIB, name + ".php"))
        for path in required:
            self.assertTrue(os.path.isfile(path), "missing " + path)

    # --------------------------------------------------------- no placeholders
    def test_no_production_placeholders(self):
        banned = re.compile(
            r"\b(TODO|FIXME|implement later|placeholder value|dummy response|fake api|mock data|lorem ipsum)\b|placeholder\s*(text|data|content)",
            re.IGNORECASE,
        )
        for path in iter_sources(MODULE):
            for number, line in enumerate(read(path).splitlines(), 1):
                self.assertIsNone(
                    banned.search(line),
                    "placeholder marker in {}:{}: {}".format(path, number, line.strip()),
                )

    def test_no_embedded_credentials(self):
        banned = re.compile(
            r"(smtp_pass|password\s*=\s*['\"][^'\"]{4,}|api[_-]?key\s*=\s*['\"][^'\"]{8,}|sk_live_)",
            re.IGNORECASE,
        )
        for path in iter_sources(MODULE):
            self.assertIsNone(banned.search(read(path)), "possible embedded credential in " + path)

    # ------------------------------------------------------------- no doubles
    def test_no_duplicate_infrastructure(self):
        """No second SMTP stack, queue, worker or logger is introduced."""
        for path in iter_sources(MODULE):
            body = read(path)
            for banned in ("PHPMailer", "SwiftMailer", "fsockopen", "stream_socket_client", "smtp_connect"):
                self.assertNotIn(banned, body, "{} introduces its own mail transport ({})".format(path, banned))
            self.assertIsNone(
                re.search(r"(?<![\w>$])mail\s*\(", body),
                "{} calls PHP mail() directly instead of the WHMCS mail system".format(path),
            )
            for banned in ("EmailService2", "CartService2", "Worker2", "SettingsService2"):
                self.assertNotIn(banned, body, "duplicate service name in " + path)
        # Delivery goes through the WHMCS mail system only.
        email_service = read(os.path.join(LIB, "EmailService.php"))
        self.assertIn("localAPI('SendEmail'", email_service)
        self.assertIn("WHMCS\\Mail\\Message", email_service)
        # The existing Foundation logger is reused rather than replaced.
        self.assertIn("Foundation\\Support\\Logger", read(os.path.join(LIB, "Log.php")))

    # --------------------------------------------------------------- security
    def test_tokens_are_random_hashed_and_never_logged(self):
        token_service = read(os.path.join(LIB, "TokenService.php"))
        self.assertIn("random_bytes(32)", token_service)
        self.assertIn("hash('sha256'", token_service)
        recovery = read(os.path.join(LIB, "RecoveryService.php"))
        self.assertIn("TokenService::hash($raw)", recovery)
        # Lookups must always go through the hash, never the raw token.
        self.assertNotIn("where('token_hash', $token)", recovery)
        # The raw token is never written to a persisted column or a log.
        for path in iter_sources(MODULE):
            body = read(path)
            self.assertNotIn("'raw_token'", body)
            self.assertIsNone(
                re.search(r"Log::(info|error|write)\([^)]*\$raw", body),
                "raw token reaches a log call in " + path,
            )

    def test_admin_actions_are_permission_checked_and_csrf_protected(self):
        admin = read(os.path.join(LIB, "AdminController.php"))
        self.assertIn("checkPermission", admin)
        self.assertIn("check_token('WHMCS.admin.default')", admin)

    def test_admin_template_escapes_every_echo(self):
        template = read(os.path.join(MODULE, "templates", "admin", "index.tpl"))
        self.assertIn("htmlspecialchars", template)
        for match in re.finditer(r"<\?php echo ([^;]+);", template):
            expression = match.group(1).strip()
            safe = (
                expression.startswith("$e(")
                or expression.startswith("$escape(")
                # Literal ternaries that can only emit fixed markup.
                or re.fullmatch(r"[^?]+\?\s*'[^'$<>]*'\s*:\s*'[^'$<>]*'", expression) is not None
            )
            self.assertTrue(safe, "unescaped echo in admin template: " + expression)

    def test_public_endpoint_never_prints_internal_errors(self):
        recover = read(os.path.join(MODULE, "recover.php"))
        self.assertIn("catch (\\Throwable $e)", recover)
        self.assertNotIn("$e->getMessage()", recover)
        self.assertIn("X-Robots-Tag", recover)

    def test_hooks_never_break_the_cart(self):
        hooks = read(os.path.join(MODULE, "hooks.php"))
        for hook in ("ClientAreaPageCart", "ShoppingCartValidateCheckout",
                     "AfterShoppingCartCheckout", "OrderPaid"):
            self.assertIn("add_hook('" + hook + "'", hooks)
        # Every WHMCS-facing hook body has its own catch-all.
        for hook_function in ("page_cart", "validate_checkout", "after_checkout", "order_paid"):
            body = hooks.split("function cloudhost247_cart_recovery_" + hook_function + "(")[1]
            body = body.split("\nfunction ")[0]
            self.assertIn("catch (\\Throwable $e)", body, hook_function + " is not exception-safe")

    # ------------------------------------------------------------ correctness
    def test_migrations_are_guarded(self):
        for name in ("V100.php", "V101.php"):
            body = read(os.path.join(MODULE, "migrations", name))
            self.assertIn("hasTable", body)
            self.assertNotIn("drop(", body)
            self.assertNotIn("dropIfExists", body)
            self.assertNotIn("DROP TABLE", body.upper())
        self.assertIn("hasColumn", read(os.path.join(MODULE, "migrations", "V101.php")))

    def test_reminder_log_has_idempotency_key(self):
        body = read(os.path.join(MODULE, "migrations", "V100.php"))
        self.assertIn("unique(array('recovery_id', 'reminder_number')", body)

    def test_defaults_are_configurable_not_hardcoded(self):
        settings = read(os.path.join(LIB, "SettingsRepository.php"))
        for key in ("abandonment_threshold", "reminder_1_delay", "reminder_2_delay",
                    "reminder_3_delay", "maximum_reminders", "token_lifetime",
                    "guest_recovery", "unsubscribe", "batch_size"):
            self.assertIn("'" + key + "'", settings)
        reminder = read(os.path.join(LIB, "ReminderService.php"))
        for literal in ("86400", "259200", "604800"):
            self.assertNotIn(literal, reminder, "reminder engine hard-codes " + literal)

    def test_revenue_comes_from_whmcs_records(self):
        revenue = read(os.path.join(LIB, "OrderRevenue.php"))
        self.assertIn("tblorders", revenue)
        self.assertIn("tblinvoices", revenue)
        recovery = read(os.path.join(LIB, "RecoveryService.php"))
        self.assertNotIn("'recovered_revenue' => $row->cart_total", recovery)

    def test_uninstall_is_not_silently_destructive(self):
        addon = read(os.path.join(MODULE, "cloudhost247_cart_recovery.php"))
        self.assertIn("cloudhost247_cart_recovery_deactivate", addon)
        self.assertNotIn("dropIfExists", addon)
        self.assertNotIn("->delete()", addon)

    def test_readme_documents_operations(self):
        readme = read(os.path.join(MODULE, "README.md"))
        for heading in ("Installation", "Configuration", "Cron", "Security", "Troubleshooting",
                        "Uninstall", "Upgrade", "Recovery rate"):
            self.assertIn(heading, readme, "README is missing a " + heading + " section")
        self.assertNotIn("/path/to/whmcs", readme)


if __name__ == "__main__":
    unittest.main()
