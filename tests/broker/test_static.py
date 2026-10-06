#!/usr/bin/env python3
"""Static verification for the CloudHost247 Domain Broker Service.

Asserts the invariants agreed for the module:
  1. structure    — expected files exist (entry, bootstrap, hooks, migration,
     every domain enum, provider adapter, repository, service, and the
     admin/client-area controllers)
  2. security     — admin/client-area guards, CSRF, ownership isolation,
     audit logging, and no dangerous PHP calls anywhere in the module
  3. no fake data — no hard-coded credentials, no fabricated "Connected"
     status, no placeholder/"coming soon" language
  4. reuse        — provider credentials always resolve through the central
     API & Integrations manager; payments always go through WHMCS's own
     invoicing; disputes reuse the case's own dispute flag
  5. idempotency  — every money/negotiation/transfer write path is keyed
  6. migration    — guarded, namespaced, non-destructive (mirrors the repo gate)
  7. docs         — the independent-rebuild write-up exists and is consistent
"""

import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODULE = os.path.join(ROOT, "modules", "addons", "cloudhost247_broker")
LIB = os.path.join(MODULE, "lib")
DOC = os.path.join(ROOT, "docs", "independent-rebuild", "DOMAIN-BROKER.md")

EXPECTED_FILES = [
    os.path.join(MODULE, "cloudhost247_broker.php"),
    os.path.join(MODULE, "bootstrap.php"),
    os.path.join(MODULE, "hooks.php"),
    os.path.join(MODULE, "migrations", "V100.php"),
    os.path.join(LIB, "Domain", "CaseStatus.php"),
    os.path.join(LIB, "Domain", "PaymentStatus.php"),
    os.path.join(LIB, "Domain", "TransferStatus.php"),
    os.path.join(LIB, "Domain", "DomainState.php"),
    os.path.join(LIB, "Domain", "DomainStatusResolver.php"),
    os.path.join(LIB, "Domain", "LookupBridgeInterface.php"),
    os.path.join(LIB, "Domain", "LegacyLookupBridge.php"),
    os.path.join(LIB, "Providers", "ProviderAdapter.php"),
    os.path.join(LIB, "Providers", "AdapterRegistry.php"),
    os.path.join(LIB, "Providers", "Capability.php"),
    os.path.join(LIB, "Providers", "ConnectionState.php"),
    os.path.join(LIB, "Providers", "AbstractIntegrationAdapter.php"),
    os.path.join(LIB, "Providers", "GoDaddyAdapter.php"),
    os.path.join(LIB, "Providers", "SedoAdapter.php"),
    os.path.join(LIB, "Providers", "AfternicAdapter.php"),
    os.path.join(LIB, "Providers", "DomainAgentsAdapter.php"),
    os.path.join(LIB, "Providers", "ManualBrokerAdapter.php"),
    os.path.join(LIB, "Routing", "AcquisitionRouter.php"),
    os.path.join(LIB, "Security", "InputValidator.php"),
    os.path.join(LIB, "Security", "CaseGuard.php"),
    os.path.join(LIB, "Security", "ClientGuard.php"),
    os.path.join(LIB, "Repositories", "CaseRepository.php"),
    os.path.join(LIB, "Repositories", "ProviderConfigRepository.php"),
    os.path.join(LIB, "Repositories", "AssignmentRepository.php"),
    os.path.join(LIB, "Repositories", "OfferRepository.php"),
    os.path.join(LIB, "Repositories", "MessageRepository.php"),
    os.path.join(LIB, "Repositories", "EventRepository.php"),
    os.path.join(LIB, "Repositories", "PaymentRepository.php"),
    os.path.join(LIB, "Repositories", "TransferRepository.php"),
    os.path.join(LIB, "Repositories", "DocumentRepository.php"),
    os.path.join(LIB, "Repositories", "SettingsRepository.php"),
    os.path.join(LIB, "Repositories", "FeeRepository.php"),
    os.path.join(LIB, "Repositories", "ProviderCallRepository.php"),
    os.path.join(LIB, "Services", "BrokerageService.php"),
    os.path.join(LIB, "Services", "NegotiationService.php"),
    os.path.join(LIB, "Services", "PaymentService.php"),
    os.path.join(LIB, "Services", "TransferService.php"),
    os.path.join(LIB, "Services", "DomainDeliveryService.php"),
    os.path.join(LIB, "Services", "FeeCalculator.php"),
    os.path.join(LIB, "Services", "CaseNumberGenerator.php"),
    os.path.join(LIB, "Services", "NotificationService.php"),
    os.path.join(LIB, "Http", "AdminController.php"),
    os.path.join(LIB, "Http", "AdminView.php"),
    os.path.join(LIB, "Http", "ClientAreaController.php"),
    os.path.join(MODULE, "templates", "list.tpl"),
    os.path.join(MODULE, "templates", "new.tpl"),
    os.path.join(MODULE, "templates", "detail.tpl"),
    os.path.join(MODULE, "migrations", "V110.php"),
    os.path.join(ROOT, "templates", "cloudhost247_legacy", "domainbrokerageterms.tpl"),
    os.path.join(ROOT, "templates", "cloudhost247", "domainbrokerageterms.tpl"),
    os.path.join(ROOT, "tests", "broker", "run.php"),
    os.path.join(ROOT, "tests", "broker", "fakes.php"),
    DOC,
]

DANGEROUS_CALL = re.compile(r"\b(eval|exec|shell_exec|system|passthru|proc_open|popen|unserialize)\s*\(", re.I)
CREDENTIAL_LITERAL = re.compile(
    r"""(?ix)
    \$?\b(api[_-]?key|api[_-]?secret|secret[_-]?key|client[_-]?secret|access[_-]?token
        |auth[_-]?token|password|passwd|consumer[_-]?key|private[_-]?key)\b
    \s*(?:=|=>|:)\s*
    (['"])(?!\s*['"])([^'"\s$]{12,})\2
    """
)
NON_SECRET = re.compile(r"(?i)(example|sample|test|dummy|placeholder|changeme|your[_-]|xxx|\{|\}|%s|\$)")


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def php_sources(base=MODULE):
    for root, _dirs, files in os.walk(base):
        for name in files:
            if name.endswith((".php", ".tpl")):
                yield os.path.join(root, name)


class BrokerStaticTests(unittest.TestCase):
    # ------------------------------------------------------------ structure
    def test_expected_files_exist(self):
        for path in EXPECTED_FILES:
            self.assertTrue(os.path.isfile(path), path)

    def test_module_entrypoint_defines_the_whmcs_addon_contract(self):
        entry = read(os.path.join(MODULE, "cloudhost247_broker.php"))
        for fn in ("cloudhost247_broker_config", "cloudhost247_broker_activate",
                   "cloudhost247_broker_deactivate", "cloudhost247_broker_output",
                   "cloudhost247_broker_clientarea"):
            self.assertIn("function " + fn, entry)
        self.assertIn("defined('WHMCS')", entry)

    def test_deactivation_is_non_destructive(self):
        entry = read(os.path.join(MODULE, "cloudhost247_broker.php"))
        self.assertIn("retained", entry.lower())
        self.assertNotIn("dropIfExists", entry)
        self.assertNotIn("DROP TABLE", entry.upper())

    def test_migration_only_creates_namespaced_tables_and_is_guarded(self):
        migration = read(os.path.join(MODULE, "migrations", "V100.php"))
        for table in re.findall(r"schema\(\)->create\('([^']+)'", migration):
            self.assertTrue(table.startswith("mod_cloudhost247_broker_"), table)
        self.assertIn("hasTable", migration)
        self.assertNotIn("DROP TABLE", migration.upper())
        self.assertNotIn("ALTER TABLE tbl", migration)

    def test_hooks_are_defensive_and_whmcs_gated(self):
        hooks = read(os.path.join(MODULE, "hooks.php"))
        self.assertIn("defined('WHMCS')", hooks)
        self.assertIn("function_exists('add_hook')", hooks)
        self.assertIn("catch (\\Throwable $e)", hooks)
        for hook in ("InvoicePaid", "InvoiceRefunded", "InvoiceCancelled"):
            self.assertIn("'" + hook + "'", hooks)

    # ------------------------------------------------------- access control
    def test_admin_actions_require_authentication_and_csrf(self):
        controller = read(os.path.join(LIB, "Http", "AdminController.php"))
        self.assertIn("AdminGuard::requireAdmin()", controller)
        self.assertIn("AdminGuard::requirePostToken()", controller)
        self.assertIn("AdminGuard::capability(", controller)

    def test_client_area_actions_require_login_and_csrf(self):
        guard = read(os.path.join(LIB, "Security", "ClientGuard.php"))
        self.assertIn("_SESSION['uid']", guard)
        self.assertIn("check_token('WHMCS.default')", guard)
        controller = read(os.path.join(LIB, "Http", "ClientAreaController.php"))
        self.assertIn("requirePostToken", controller)

    def test_ownership_isolation_is_enforced_at_the_repository_layer(self):
        case_repo = read(os.path.join(LIB, "Repositories", "CaseRepository.php"))
        self.assertIn("belongsToClient", case_repo)
        guard = read(os.path.join(LIB, "Security", "CaseGuard.php"))
        self.assertIn("assertOwnedByClient", guard)
        client_controller = read(os.path.join(LIB, "Http", "ClientAreaController.php"))
        self.assertIn("assertOwnedByClient", client_controller)

    def test_every_state_change_is_audited(self):
        for name in ("BrokerageService.php", "NegotiationService.php", "PaymentService.php", "TransferService.php"):
            text = read(os.path.join(LIB, "Services", name))
            self.assertIn("AuditLogger::record(", text, name)

    def test_rate_limiting_is_real_and_db_backed(self):
        service = read(os.path.join(LIB, "Services", "BrokerageService.php"))
        self.assertIn("assertWithinRateLimit", service)
        repo = read(os.path.join(LIB, "Repositories", "CaseRepository.php"))
        self.assertIn("countCreatedSince", repo)

    def test_no_dangerous_calls_anywhere_in_the_module(self):
        for path in php_sources():
            self.assertIsNone(DANGEROUS_CALL.search(read(path)), path)

    # -------------------------------------------------------------- secrets
    def test_module_owns_no_separate_credential_store(self):
        for name in ("Vault", "SecretStore", "CredentialStore", "KeyStore"):
            for path in php_sources(LIB):
                self.assertNotIn(name, os.path.basename(path))

    def test_provider_adapters_resolve_credentials_through_central_integrations(self):
        abstract = read(os.path.join(LIB, "Providers", "AbstractIntegrationAdapter.php"))
        self.assertIn("IntegrationManager", abstract)
        for name in ("GoDaddyAdapter.php", "SedoAdapter.php", "AfternicAdapter.php", "DomainAgentsAdapter.php"):
            text = read(os.path.join(LIB, "Providers", name))
            # Adapters must go through the shared integration client, never
            # embed or read a literal API key of their own.
            self.assertNotRegex(text, r"['\"]api[_-]?key['\"]\s*(?:=>|=)\s*['\"][^'\"]{8,}['\"]")


    def test_owned_code_has_no_hard_coded_credentials(self):
        findings = []
        for path in php_sources():
            for match in CREDENTIAL_LITERAL.finditer(read(path)):
                if NON_SECRET.search(match.group(3)):
                    continue
                findings.append("{}: {}".format(path, match.group(1)))
        self.assertEqual(findings, [])

    def test_no_private_keys_are_committed(self):
        bad = re.compile(r"-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}")
        for path in php_sources():
            self.assertIsNone(bad.search(read(path)), path)

    # ------------------------------------------------------------ no fakery
    def test_connection_state_is_never_hard_coded_connected(self):
        for name in ("GoDaddyAdapter.php", "SedoAdapter.php", "AfternicAdapter.php", "DomainAgentsAdapter.php"):
            text = read(os.path.join(LIB, "Providers", name))
            self.assertNotIn("return ConnectionState::CONNECTED;", text, name)

    def test_no_placeholder_or_todo_language_in_shipped_code(self):
        for path in php_sources():
            text = read(path).lower()
            self.assertNotIn("coming soon", text, path)
            self.assertNotIn("todo:", text, path)
            self.assertNotIn("fixme", text, path)

    def test_domain_registered_is_never_presented_as_for_sale(self):
        state = read(os.path.join(LIB, "Domain", "DomainState.php"))
        self.assertIn("REGISTERED", state)
        self.assertNotIn("'registered' => 'For sale'", state)

    def test_manual_broker_is_the_guaranteed_fallback(self):
        router = read(os.path.join(LIB, "Routing", "AcquisitionRouter.php"))
        self.assertIn("ROUTE_D", router)
        manual = read(os.path.join(LIB, "Providers", "ManualBrokerAdapter.php"))
        self.assertIn("No external API", manual)

    # --------------------------------------------------------------- reuse
    def test_payment_reuses_the_existing_whmcs_invoicing_system(self):
        payments = read(os.path.join(LIB, "Services", "PaymentService.php"))
        self.assertIn("localAPI('CreateInvoice'", payments)
        self.assertIn("localAPI('GetInvoice'", payments)
        self.assertNotIn("curl_init", payments)

    def test_disputes_reuse_the_cases_own_dispute_flag(self):
        service = read(os.path.join(LIB, "Services", "BrokerageService.php"))
        self.assertIn("markDisputed", service)
        self.assertIn("resolveDispute", service)
        transfer = read(os.path.join(LIB, "Services", "TransferService.php"))
        self.assertIn("disputed", transfer)

    # ------------------------------------------------------- idempotency
    def test_idempotency_keys_exist_on_every_money_or_state_changing_flow(self):
        migration = read(os.path.join(MODULE, "migrations", "V100.php"))
        self.assertGreaterEqual(migration.count("idempotency_key"), 4)
        for name, needle in (
            ("BrokerageService.php", "findByIdempotencyKey"),
            ("NegotiationService.php", "findByIdempotencyKey"),
            ("PaymentService.php", "findByIdempotencyKey"),
        ):
            self.assertIn(needle, read(os.path.join(LIB, "Services", name)), name)
        transfer = read(os.path.join(LIB, "Services", "TransferService.php"))
        self.assertIn("idempotency_key", transfer)

    def test_transfer_never_completes_before_verification(self):
        transfer = read(os.path.join(LIB, "Services", "TransferService.php"))
        self.assertIn("TransferStatus::VERIFIED", transfer)
        complete_fn = transfer[transfer.index("function complete("):]
        self.assertIn("must be verified", complete_fn)

    def test_fees_are_itemized_never_a_single_opaque_total(self):
        calculator = read(os.path.join(LIB, "Services", "FeeCalculator.php"))
        for field in ("acquisition_price", "brokerage_fee", "transfer_fee", "service_fee", "total"):
            self.assertIn("'" + field + "'", calculator)

    # ------------------------------------------------------------- capability
    def test_capability_policy_covers_the_new_module(self):
        core = read(os.path.join(ROOT, "modules", "addons", "cloudhost247_core", "cloudhost247_core.php"))
        self.assertIn("cloudhost247_broker", core)

    def test_offers_and_events_are_immutable_insert_only(self):
        offer_repo = read(os.path.join(LIB, "Repositories", "OfferRepository.php"))
        self.assertNotIn("public function update(", offer_repo)
        self.assertNotIn("public function delete(", offer_repo)
        event_repo = read(os.path.join(LIB, "Repositories", "EventRepository.php"))
        self.assertNotIn("public function update(", event_repo)
        self.assertNotIn("public function delete(", event_repo)
        negotiation = read(os.path.join(LIB, "Services", "NegotiationService.php"))
        self.assertIn("it never", negotiation.lower())
        self.assertIn("always derived from the full history", negotiation.lower())

    # ------------------------------------------------- cross-module CTA (item 1/2/37/47)
    def test_legacy_domain_search_cta_is_honestly_gated(self):
        """The existing domain search/WHOIS tool only offers "Broker This
        Domain" when this module is actually installed and turned on -- it
        must never hard-code the CTA as available."""
        entry = read(os.path.join(ROOT, "modules", "addons", "cloudhost247_domain_lookup", "cloudhost247_domain_lookup.php"))
        self.assertIn("class_exists('CloudHost247\\\\Broker\\\\Repositories\\\\SettingsRepository')", entry)
        self.assertIn("isBrokerageEnabled", entry)
        self.assertNotIn("brokerAvailable=true", entry.replace(" ", ""))
        self.assertIn("brokerAvailable", entry)
        self.assertIn("brokerNewCaseUrl", entry)

        template = read(os.path.join(ROOT, "modules", "addons", "cloudhost247_domain_lookup", "templates", "client", "tool.tpl"))
        self.assertIn("cloudhost247-broker-enabled", template)
        self.assertIn("cloudhost247-broker-url", template)

        js = read(os.path.join(ROOT, "modules", "addons", "cloudhost247_domain_lookup", "assets", "js", "cloudhost247-tools.js"))
        self.assertIn("brokerEnabled: false", js)
        self.assertIn("config.brokerEnabled = $('#cloudhost247-broker-enabled').val() === '1'", js)
        self.assertIn("if (!config.brokerEnabled", js)
        # Only a taken/registered domain may ever get the CTA -- never an
        # available one.
        self.assertIn("if (itemClass === 'taken')", js)
        self.assertNotIn("acquisition is guaranteed", js.lower())

    def test_page_builder_widgets_reuse_the_same_live_capability_gate(self):
        """The six Domain Brokerage Page Builder widgets (item 37) never
        invent availability, fee or case data -- they read it through the
        same LiveDataSource contract every other business widget uses."""
        builder = os.path.join(ROOT, "modules", "addons", "cloudhost247_builder")
        catalog = read(os.path.join(builder, "lib", "Widgets", "WidgetCatalog.php"))
        for widget_key in ("broker_this_domain", "domain_brokerage_cta", "brokerage_status",
                            "customer_brokerage_cases", "brokerage_pricing", "brokerage_faq"):
            self.assertIn("'" + widget_key + "' => array(", catalog)

        contract = read(os.path.join(builder, "lib", "Contracts", "LiveDataSource.php"))
        for method in ("function brokerageAvailability()", "function brokerageFees()", "function brokerageCases("):
            self.assertIn(method, contract)

        data_source = read(os.path.join(builder, "lib", "Catalog", "WhmcsDataSource.php"))
        self.assertIn("CloudHost247\\\\Broker\\\\Repositories\\\\SettingsRepository", data_source)
        self.assertIn("CloudHost247\\\\Broker\\\\Repositories\\\\FeeRepository", data_source)
        self.assertIn("CloudHost247\\\\Broker\\\\Repositories\\\\CaseRepository", data_source)

        renderer = read(os.path.join(builder, "lib", "Render", "WidgetRenderer.php"))
        self.assertIn("Domain Brokerage is not installed", renderer)
        self.assertIn("not currently being accepted", renderer)
        self.assertIn("Sign in to view", renderer)

    # ------------------------------------------------- delivery (item 25/29)
    def test_delivery_uses_the_whmcs_api_and_never_writes_core_domain_tables(self):
        service = read(os.path.join(LIB, "Services", "DomainDeliveryService.php"))
        self.assertIn("localAPI('GetClientsDomains'", service)
        self.assertIn("localAPI('AddClientDomain'", service)
        self.assertNotIn("tbldomains", service)
        # Delivery is confirmed, never assumed:
        self.assertIn("pending_manual", service)
        self.assertIn("associated", service)
        self.assertIn("findClientDomain", service)

    def test_transfer_completion_and_delivery_are_idempotent(self):
        transfer = read(os.path.join(LIB, "Services", "TransferService.php"))
        complete_fn = transfer[transfer.index("function complete("):]
        self.assertIn("TransferStatus::COMPLETED) {", complete_fn)
        self.assertIn("already completed", complete_fn.lower())
        # Completion triggers the real delivery attempt:
        self.assertIn("->associate(", complete_fn)

    def test_delivery_migration_is_additive_and_column_guarded(self):
        migration = read(os.path.join(MODULE, "migrations", "V110.php"))
        self.assertIn("'1.1.0'", migration)
        self.assertIn("hasColumn", migration)
        self.assertIn("mod_cloudhost247_broker_transfers", migration)
        for forbidden in ("dropIfExists", "DROP TABLE", "->rename(", "tbldomains"):
            self.assertNotIn(forbidden, migration)
        # The migration validator expects this version registered:
        validator = read(os.path.join(ROOT, "scripts", "validate-migrations.py"))
        self.assertIn("'cloudhost247_broker':['1.0.0','1.1.0']", validator)

    def test_completion_notification_does_not_claim_delivery_before_it_happens(self):
        notifications = read(os.path.join(LIB, "Services", "NotificationService.php"))
        completed_idx = notifications.index("function transferCompleted")
        delivered_idx = notifications.index("function domainDelivered")
        completed_body = notifications[completed_idx:delivered_idx]
        self.assertNotIn("is now associated", completed_body)
        self.assertIn("customer_notifications_enabled", notifications)

    # ------------------------------------------------- provider calls (item 38)
    def test_provider_calls_are_recorded_in_the_idempotent_ledger(self):
        adapter = read(os.path.join(LIB, "Providers", "GoDaddyAdapter.php"))
        self.assertIn("ProviderCallRepository", adapter)
        self.assertIn("->record(", adapter)
        self.assertIn("domain_availability", adapter)
        self.assertIn("correlation", adapter)
        self.assertIn("latencyMs", adapter)
        ledger = read(os.path.join(LIB, "Repositories", "ProviderCallRepository.php"))
        self.assertIn("alreadyPerformed", ledger)
        self.assertIn("latency_ms", ledger)

    # ------------------------------------------------- customer dashboard
    def test_customer_dashboard_shows_next_action_agreement_and_delivery(self):
        controller = read(os.path.join(LIB, "Http", "ClientAreaController.php"))
        self.assertIn("next_action", controller)
        self.assertIn("accepted_offer", controller)
        self.assertIn("delivery_label", controller)
        detail = read(os.path.join(MODULE, "templates", "detail.tpl"))
        self.assertIn("Next action", detail)
        self.assertIn("Agreement reached", detail)
        self.assertIn("delivery_label", detail)
        listing = read(os.path.join(MODULE, "templates", "list.tpl"))
        self.assertIn("next_action", listing)

    # ------------------------------------------------- legal terms (item 36)
    def test_terms_page_uses_real_theme_templates_and_covers_the_required_points(self):
        page = read(os.path.join(ROOT, "domain-brokerage-terms.php"))
        self.assertNotIn("templates/5.7", page)
        self.assertIn("WHMCS\\ClientArea", page)
        self.assertIn("setTemplate('domainbrokerageterms')", page)
        for point in (
            "Acquisition is not guaranteed",
            "registered by someone else only means it is unavailable",
            "brokerage fee",
            "transfer fee",
            "Refund",
            "expire",
            "Cancellation",
            "Disputes",
            "privacy",
            "provider",
        ):
            self.assertIn(point.lower(), page.lower())
        for theme in ("cloudhost247_legacy", "cloudhost247"):
            tpl = read(os.path.join(ROOT, "templates", theme, "domainbrokerageterms.tpl"))
            if theme == "cloudhost247":
                self.assertIn("includes/legal/domainbrokerageterms.tpl", tpl)
                tpl += read(os.path.join(ROOT, "templates", theme, "includes", "legal", "domainbrokerageterms.tpl"))
            self.assertIn("brokerageTerms", tpl)

    # --------------------------------------------------------------- docs
    def test_documentation_exists_and_covers_every_provider(self):
        doc = read(DOC)
        for key in ("godaddy", "sedo", "afternic", "domainagents", "manual"):
            self.assertIn("`" + key + "`", doc)
        for section in ("Safety model", "Architecture", "Provider adapters", "Security controls",
                        "Idempotency", "Installation", "Testing", "Feature status"):
            self.assertIn(section, doc)


if __name__ == "__main__":
    unittest.main()
