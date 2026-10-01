#!/usr/bin/env python3
"""
CloudHost247 Marketing — static invariants (SESSION 1 foundation).

No PHP runtime required. Mirrors tests/broker/test_static.py philosophy:
structure, security and "no fake/duplicate infrastructure" guarantees.
"""
import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODULE = os.path.join(ROOT, "modules", "addons", "cloudhost247_marketing")
LIB = os.path.join(MODULE, "lib")


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def iter_php(base):
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith(".php"):
                yield os.path.join(dirpath, name)


class MarketingStaticTests(unittest.TestCase):
    # ------------------------------------------------------------- structure
    def test_foundation_files_exist(self):
        required = [
            os.path.join(MODULE, "cloudhost247_marketing.php"),
            os.path.join(MODULE, "bootstrap.php"),
            os.path.join(MODULE, "hooks.php"),
            os.path.join(MODULE, "migrations", "V100.php"),
            os.path.join(LIB, "Domain", "CampaignStatus.php"),
            os.path.join(LIB, "Domain", "SubscriberStatus.php"),
            os.path.join(LIB, "Domain", "QueueStatus.php"),
            os.path.join(LIB, "Domain", "ResultKind.php"),
            os.path.join(LIB, "Domain", "EventType.php"),
            os.path.join(LIB, "Domain", "SuppressionReason.php"),
            os.path.join(LIB, "Repositories", "SettingsRepository.php"),
            os.path.join(LIB, "Security", "InputValidator.php"),
            os.path.join(LIB, "Security", "HtmlSanitizer.php"),
            os.path.join(LIB, "Domain", "CampaignAudience.php"),
            os.path.join(LIB, "Domain", "SegmentField.php"),
            os.path.join(LIB, "Domain", "SegmentOperator.php"),
            os.path.join(LIB, "Domain", "TemplateBlock.php"),
            os.path.join(LIB, "Repositories", "CampaignRepository.php"),
            os.path.join(LIB, "Repositories", "SegmentRepository.php"),
            os.path.join(LIB, "Repositories", "TemplateRepository.php"),
            os.path.join(LIB, "Services", "CampaignService.php"),
            os.path.join(LIB, "Services", "MessageTransport.php"),
            os.path.join(LIB, "Services", "UnavailableTransport.php"),
            os.path.join(LIB, "Services", "SegmentService.php"),
            os.path.join(LIB, "Services", "TemplateService.php"),
            os.path.join(LIB, "Http", "AdminController.php"),
            os.path.join(LIB, "Http", "AdminView.php"),
            os.path.join(ROOT, "tests", "marketing", "run.php"),
            os.path.join(ROOT, "tests", "marketing", "fakes.php"),
            os.path.join(ROOT, "docs", "independent-rebuild", "EMAIL-MARKETING-AUDIT.md"),
        ]
        for path in required:
            self.assertTrue(os.path.isfile(path), "Missing " + path)

    # ------------------------------------------------------ migration safety
    def test_migration_is_additive_namespaced_and_guarded(self):
        migration = read(os.path.join(MODULE, "migrations", "V100.php"))
        self.assertIn("'1.0.0'", migration)
        creates = re.findall(r"->create\(\s*'(mod_cloudhost247_marketing_[a-z_]+)'", migration)
        guards = migration.count("hasTable")
        self.assertEqual(16, len(creates), "expected 16 module tables")
        self.assertGreaterEqual(guards, len(creates))
        for forbidden in ("dropIfExists", "DROP TABLE", "->rename(", "tblclients", "tblhosting", "tbldomains"):
            self.assertNotIn(forbidden, migration)
        # every table is namespaced under the module, matching repo convention
        self.assertNotRegex(migration, r"->create\(\s*'(?!mod_cloudhost247_marketing_)")
        # no credentials of any kind are persisted by the module
        self.assertNotIn("password", migration)

    def test_every_later_migration_is_additive_namespaced_and_guarded(self):
        # Additive is a property of the whole migration set, not just the first
        # one: a later migration that drops, renames or reaches into a WHMCS
        # core table would break an existing install.
        for name in ("V110.php", "V120.php"):
            migration = read(os.path.join(MODULE, "migrations", name))
            for forbidden in ("dropIfExists", "DROP TABLE", "->dropColumn", "->rename("):
                self.assertNotIn(forbidden, migration, "%s contains %s" % (name, forbidden))
            self.assertNotRegex(migration, r"->(?:create|table)\(\s*'(?!mod_cloudhost247_marketing_)", name)
            self.assertNotIn("password", migration)
            self.assertNotRegex(migration, r"(?:tblclients|tblhosting|tbldomains)", name)
            self.assertTrue("hasTable" in migration or "hasColumn" in migration, "%s is unguarded" % name)

    def test_migration_validator_is_pinned_to_marketing_versions(self):
        # The validator must know every migration this module ships; a new
        # migration that is not registered there fails the release candidate.
        validator = read(os.path.join(ROOT, "scripts", "validate-migrations.py"))
        self.assertIn("'cloudhost247_marketing':['1.0.0','1.1.0','1.2.0']", validator)

    # ---------------------------------------------------------- security
    def test_no_dangerous_calls_and_no_core_table_writes_anywhere(self):
        dangerous = ("eval(", "shell_exec(", "exec(", "system(", "passthru(", "popen(", "base64_decode(", "gzinflate(", "str_rot13(")
        for path in iter_php(MODULE):
            body = read(path)
            for call in dangerous:
                self.assertNotIn(call, body, "%s in %s" % (call, path))
        combined = ""
        for path in iter_php(MODULE):
            combined += read(path)
        # the module must never read/write WHMCS core tables directly
        self.assertNotRegex(combined, r"Capsule::table\(['\"]tbl")
        self.assertNotRegex(combined, r"->(?:create|table|drop|rename)\(['\"]tbl")

    def test_delivery_goes_through_the_transport_contract_only(self):
        # Campaign, segment and template code must never open a socket, call the
        # mail() function or name a credential. Delivery is a transport's job —
        # which is also what keeps credentials in the integrations vault.
        service = read(os.path.join(LIB, "Services", "CampaignService.php"))
        self.assertIn("MessageTransport", service)
        for forbidden in ("fsockopen", "stream_socket_client", "STARTTLS", "smtp_pass", "smtp_user"):
            self.assertNotIn(forbidden, service)
        self.assertNotRegex(service, r"(?<![A-Za-z_])mail\s*\(")  # `Email(` in a validator name is not a mail call
        combined = ""
        for path in iter_php(MODULE):
            combined += read(path)
        for forbidden in ("fsockopen", "stream_socket_client", "swiftmailer", "PHPMailer"):
            self.assertNotIn(forbidden, combined)

    def test_module_never_touches_smtp_secrets_directly(self):
        combined = ""
        for path in iter_php(MODULE):
            combined += read(path)
        self.assertNotIn("SecretVault::decrypt", combined)
        self.assertNotIn("CH247_INTEGRATIONS_KEY", combined)
        self.assertNotIn("mod_cloudhost247_integration_secrets", combined)

    def test_admin_surface_is_guarded(self):
        controller = read(os.path.join(LIB, "Http", "AdminController.php"))
        self.assertIn("AdminGuard::requireAdmin()", controller)
        self.assertIn("AdminGuard::requirePostToken()", controller)
        self.assertIn("requireCapability('cloudhost247_marketing'", controller)
        self.assertIn("AuditLogger::record(", controller)
        module = read(os.path.join(MODULE, "cloudhost247_marketing.php"))
        self.assertIn("die('This file cannot be accessed directly')", module)
        view = read(os.path.join(LIB, "Http", "AdminView.php"))
        self.assertIn("htmlspecialchars", view)

    def test_capability_allowlist_accepts_the_marketing_module(self):
        core = read(os.path.join(ROOT, "modules", "addons", "cloudhost247_core", "cloudhost247_core.php"))
        self.assertGreaterEqual(core.count("cloudhost247_marketing"), 2)

    # ------------------------------------------------------- navigation
    def test_admin_menu_covers_the_spec_sections(self):
        hooks = read(os.path.join(MODULE, "hooks.php"))
        self.assertIn("AdminAreaMainMenu", hooks)
        for label in ("Email Campaigns", "Create Campaign", "Subscribers", "Lists", "Segments",
                      "Templates", "Automations", "Analytics", "Delivery Settings", "Suppression List"):
            self.assertIn(label, hooks)

    # ------------------------------------------------ no duplicated systems
    def test_no_new_credential_store_tables_or_smtp_settings(self):
        migration = read(os.path.join(MODULE, "migrations", "V100.php"))
        for banned in ("smtp_host", "smtp_port", "smtp_user", "smtp_pass", "api_key", "secret"):
            self.assertNotIn(banned, migration)
        catalog = read(os.path.join(ROOT, "modules", "addons", "cloudhost247_integrations", "lib", "Registry", "ProviderCatalog.php"))
        self.assertIn("'key' => 'cpanel_smtp'", catalog)
        self.assertIn("modules/addons/cloudhost247_marketing", catalog)

    # ------------------------------------------------- honesty conventions
    def test_status_vocabularies_are_closed_and_spec_conformant(self):
        campaign = read(os.path.join(LIB, "Domain", "CampaignStatus.php"))
        for state in ("DRAFT", "READY", "SCHEDULED", "QUEUED", "SENDING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED", "ARCHIVED"):
            self.assertIn(state, campaign)
        subscriber = read(os.path.join(LIB, "Domain", "SubscriberStatus.php"))
        for state in ("SUBSCRIBED", "UNSUBSCRIBED", "PENDING", "BOUNCED", "SUPPRESSED"):
            self.assertIn(state, subscriber)
        queue = read(os.path.join(LIB, "Domain", "QueueStatus.php"))
        self.assertIn("Accepted by relay", queue)  # never claims "delivered" for SMTP-accepted

    def test_no_placeholder_language(self):
        # "placeholder" is banned as *copy* (an unfinished-content marker), not as
        # the HTML input attribute: input[placeholder] is the standard way to hint
        # a field, so that one form is normalised away before the scan.
        banned = ("coming soon", "todo:", "fixme", "lorem ipsum", "placeholder")
        for path in iter_php(MODULE):
            body = re.sub(r'placeholder\s*=\s*"', 'input-hint="', read(path).lower())
            for phrase in banned:
                self.assertNotIn(phrase, body, "'%s' in %s" % (phrase, path))


if __name__ == "__main__":
    unittest.main()
