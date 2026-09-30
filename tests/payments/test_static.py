"""CloudHost247 Payments (Blockonomics) static verification.

Executable without PHP/WHMCS. Verifies the acceptance criteria that are visible in
source: one authoritative gateway, server-side enforcement wiring, callback hardening,
credential secrecy, audit logging, explicit USDT network display, no unsafe mark-as-paid,
and PHP structural sanity (quote/heredoc-aware brace balance) for every touched file.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
GATEWAY_ENTRY = ROOT / 'modules/gateways/blockonomics.php'
GATEWAY_LIB = ROOT / 'modules/gateways/blockonomics/blockonomics.php'
GATEWAY_SETTINGS = ROOT / 'modules/gateways/blockonomics/lib/GatewaySettings.php'
PAYMENT_PAGE = ROOT / 'modules/gateways/blockonomics/payment.php'
CALLBACK = ROOT / 'modules/gateways/callback/blockonomics.php'
ADDON = ROOT / 'modules/addons/cloudhost247_payments'
TEMPLATES = ROOT / 'modules/gateways/blockonomics/assets/templates'

TOUCHED_PHP = [
    GATEWAY_ENTRY, GATEWAY_LIB, GATEWAY_SETTINGS, PAYMENT_PAGE, CALLBACK,
    ADDON / 'cloudhost247_payments.php', ADDON / 'bootstrap.php',
    ADDON / 'lib/Services/AdminController.php', ADDON / 'lib/Services/TransactionsView.php',
    ADDON / 'lib/Support/StatusMapper.php',
]


def php_brace_balance(source: str):
    """Quote/comment/heredoc-aware scan; returns (curly, paren) balance."""
    i, n = 0, len(source)
    curly = paren = 0
    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ''
        if ch == '/' and nxt == '/':
            i = source.find('\n', i)
            i = n if i == -1 else i
            continue
        if ch == '#':
            i = source.find('\n', i)
            i = n if i == -1 else i
            continue
        if ch == '/' and nxt == '*':
            end = source.find('*/', i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch in ('"', "'"):
            quote = ch
            i += 1
            while i < n:
                if source[i] == '\\':
                    i += 2
                    continue
                if source[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if ch == '<' and source.startswith('<<<', i):
            match = re.match(r"<<<['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\r?\n", source[i:])
            if match:
                terminator = match.group(1)
                end = re.search(r'^\s*' + re.escape(terminator) + r'\b', source[i + match.end():], re.M)
                i = n if end is None else i + match.end() + end.end()
                continue
        if ch == '{':
            curly += 1
        elif ch == '}':
            curly -= 1
        elif ch == '(':
            paren += 1
        elif ch == ')':
            paren -= 1
        i += 1
    return curly, paren


class BlockonomicsStaticTests(unittest.TestCase):
    # ------------------------------------------------------------ single gateway
    def test_no_duplicate_gateway_created(self):
        gateways = ROOT / 'modules/gateways'
        offenders = [p.name for p in gateways.glob('*blockonomic*') if p.name not in ('blockonomics.php', 'blockonomics')]
        self.assertEqual(offenders, [], 'exactly one authoritative Blockonomics gateway')
        self.assertTrue(GATEWAY_ENTRY.is_file())
        self.assertTrue((ROOT / 'modules/gateways/callback/blockonomics.php').is_file())

    def test_existing_order_table_is_reused_not_replaced(self):
        lib = GATEWAY_LIB.read_text()
        self.assertIn("blockonomics_orders", lib)
        addon_sources = '\n'.join(p.read_text() for p in ADDON.rglob('*.php'))
        self.assertNotIn("schema()->create", addon_sources, 'the payments addon creates no tables')
        self.assertNotIn('dropIfExists', addon_sources)

    # ------------------------------------------------------- server-side enforcement
    def test_settings_resolver_is_single_source(self):
        for path, needle in [
            (GATEWAY_LIB, 'GatewaySettings::effectiveCurrencies()'),
            (GATEWAY_LIB, 'GatewaySettings::resolveApiKey()'),
            (GATEWAY_ENTRY, 'GatewaySettings::gatewayEnabled()'),
            (PAYMENT_PAGE, 'GatewaySettings::currencyAvailable'),
            (PAYMENT_PAGE, 'GatewaySettings::gatewayEnabled()'),
        ]:
            self.assertIn(needle, path.read_text(), f'{path.name} must resolve through GatewaySettings')

    def test_payment_page_rejects_disabled_methods_server_side(self):
        page = PAYMENT_PAGE.read_text()
        self.assertIn('http_response_code(403)', page)
        self.assertIn('creating_new_payment', page)
        self.assertIn('unavailableMessage', page)

    def test_gateway_link_fails_closed_with_safe_message(self):
        entry = GATEWAY_ENTRY.read_text()
        self.assertIn('Cryptocurrency payments are currently unavailable.', entry)

    def test_master_switch_and_matrix_logic_exist(self):
        settings = GATEWAY_SETTINGS.read_text()
        for needle in ('gatewayEnabledFrom', 'effectiveCurrenciesFrom', 'usdtConfigValidFrom',
                       'usdtAddressValid', 'usdtNetworkValid', 'supportedUsdtNetworks'):
            self.assertIn(needle, settings)
        # BTC/USDT are never hard-coded enabled in the resolver.
        self.assertNotIn("'btcEnabled' => 'on'", settings)

    def test_usdt_networks_are_only_those_the_implementation_supports(self):
        settings = GATEWAY_SETTINGS.read_text()
        self.assertIn("'ethereum'", settings)
        self.assertIn("'sepolia'", settings)
        for invented in ('trc', 'bep', 'solana', 'polygon', 'tron'):
            self.assertNotIn(invented, settings.lower())

    # ------------------------------------------------------------ callback hardening
    def test_callback_uses_timing_safe_secret_and_input_validation(self):
        callback = CALLBACK.read_text()
        self.assertIn('hash_equals', callback)
        self.assertIn('http_response_code(403)', callback)
        self.assertIn('http_response_code(400)', callback)
        self.assertGreaterEqual(callback.count('preg_match'), 3, 'status/value/addr/txid shape validation')
        self.assertIn('http_response_code(404)', callback)
        self.assertIn('checkIfTransactionExists', callback)  # duplicate-transaction guard retained
        self.assertIn('checkCbInvoiceID', callback)          # invoice identity validation retained

    def test_callback_never_logs_the_secret(self):
        callback = CALLBACK.read_text()
        self.assertIn("[REDACTED]", callback)
        self.assertNotIn("logTransaction($gatewayParams['name'], $_GET", callback)

    def test_unknown_address_fails_closed(self):
        lib = GATEWAY_LIB.read_text()
        self.assertIn('if ($existing_order === null)', lib)

    # ----------------------------------------------------------------- credentials
    def test_vault_bridge_with_legacy_fallback(self):
        settings = GATEWAY_SETTINGS.read_text()
        self.assertIn('IntegrationManager', settings)
        self.assertIn('optionalCredentials', settings)
        self.assertIn("blockonomics", settings)
        self.assertIn("apiKeySource", settings)
        # Integrations centre really registers the provider this bridge targets.
        catalog = (ROOT / 'modules/addons/cloudhost247_integrations/lib/Registry/ProviderCatalog.php').read_text()
        self.assertIn("'key' => 'blockonomics'", catalog)

    def test_admin_page_never_renders_or_accepts_the_api_key(self):
        controller = (ADDON / 'lib/Services/AdminController.php').read_text()
        self.assertNotIn('name="ApiKey"', controller)
        self.assertNotIn('resolveApiKey()', controller.split('classifyConnection')[0],
                         'the key is only touched inside the server-side connection test')
        self.assertIn('&bull;', controller)  # masked display
        self.assertIn('Replace API Key', controller)

    def test_connection_test_is_server_side_and_sanitized(self):
        controller = (ADDON / 'lib/Services/AdminController.php').read_text()
        for classification in ('Connected successfully', 'Authentication failed',
                               'Invalid configuration', 'Provider unavailable', 'Connection timeout'):
            self.assertIn(classification, controller)
        self.assertIn('body intentionally discarded', controller)

    # ------------------------------------------------------------------- admin addon
    def test_addon_structure_and_authorization(self):
        for path in ('cloudhost247_payments.php', 'bootstrap.php',
                     'lib/Services/AdminController.php', 'lib/Services/TransactionsView.php',
                     'lib/Support/StatusMapper.php'):
            self.assertTrue((ADDON / path).is_file(), path)
        controller = (ADDON / 'lib/Services/AdminController.php').read_text()
        self.assertIn('AdminGuard::requirePostToken()', controller)  # CSRF on every mutation
        self.assertIn("payments.configure", controller)
        self.assertIn("payments.gateway.test", controller)
        self.assertIn("payments.crypto.view", (ADDON / 'lib/Services/TransactionsView.php').read_text())

    def test_configuration_changes_are_audited_with_before_after(self):
        controller = (ADDON / 'lib/Services/AdminController.php').read_text()
        self.assertIn('AuditLogger::record', controller)
        self.assertIn("'before' =>", controller)
        self.assertIn("'after' =>", controller)
        self.assertIn('blockonomics.connection_tested', controller)

    def test_no_unsafe_mark_as_paid(self):
        sources = '\n'.join(p.read_text() for p in ADDON.rglob('*.php'))
        self.assertNotIn('Mark as Paid', sources)
        self.assertNotIn('addInvoicePayment', sources, 'the addon never credits invoices')
        self.assertIn('hasWhmcsPayment', sources)  # Paid is derived from real accounting records

    def test_enable_validation_blocks_nonfunctional_methods(self):
        controller = (ADDON / 'lib/Services/AdminController.php').read_text()
        self.assertIn('USDT cannot be enabled because the required network/receiving configuration is incomplete',
                      controller)
        self.assertIn('no Blockonomics API key is configured', controller)

    # ------------------------------------------------------------- customer display
    def test_usdt_network_is_explicit_with_loss_warning(self):
        options = (TEMPLATES / 'crypto_options.tpl').read_text()
        self.assertIn('usdt_network_label', options)
        checkout = (TEMPLATES / 'web3_checkout.tpl').read_text()
        self.assertIn('usdt_network_label', checkout)
        self.assertIn('permanent loss of funds', checkout)
        lib = GATEWAY_LIB.read_text()
        self.assertIn('usdt_network_label', lib)

    def test_status_mapper_never_pays_without_accounting_record(self):
        mapper = (ADDON / 'lib/Support/StatusMapper.php').read_text()
        self.assertIn('hasWhmcsPayment', mapper)
        self.assertIn('CONFIRMING', mapper.split('if (!$hasWhmcsPayment)')[1][:200].upper())

    # ------------------------------------------------------------------ structural
    def test_touched_php_files_are_structurally_balanced(self):
        for path in TOUCHED_PHP:
            self.assertTrue(path.is_file(), str(path))
            curly, paren = php_brace_balance(path.read_text())
            self.assertEqual((curly, paren), (0, 0), f'{path} braces/parens balanced')

    def test_php_run_tests_exist_for_ci_with_php(self):
        run = (ROOT / 'tests/payments/run.php').read_text()
        for scenario in ('A:', 'B:', 'C:', 'D:', 'E:'):
            self.assertIn(scenario, run)
        self.assertIn('Underpaid', run)
        self.assertIn('Expired', run)


if __name__ == '__main__':
    unittest.main()
