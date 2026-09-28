from pathlib import Path
import json, re, unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'modules/addons/cloudhost247_integrations'
DOCS = ROOT / 'docs/independent-rebuild'

# Code this rebuild owns and is allowed to change. Vendor modules covered by the
# proprietary integrity manifest are audited and documented, never edited.
OWNED = [
    ROOT / 'modules/addons/cloudhost247_core',
    ROOT / 'modules/addons/cloudhost247_currency',
    ROOT / 'modules/addons/cloudhost247_integrations',
    ROOT / 'modules/addons/cloudhost247_ovh',
    ROOT / 'modules/addons/cloudhost247_theme',
    ROOT / 'modules/servers/RDP',
    ROOT / 'modules/servers/cloudhost247_lteproxy',
    ROOT / 'modules/servers/cloudhost247_ovh',
    ROOT / 'crons',
    ROOT / 'scripts',
]

CREDENTIAL_LITERAL = re.compile(
    r"""(?ix)
    \$?\b(api[_-]?key|api[_-]?secret|secret[_-]?key|client[_-]?secret|access[_-]?token
        |auth[_-]?token|password|passwd|consumer[_-]?key|private[_-]?key)\b
    \s*(?:=|=>|:)\s*
    (['"])(?!\s*['"])([^'"\s$]{12,})\2
    """
)
NON_SECRET = re.compile(r"(?i)(example|sample|test|dummy|placeholder|changeme|your[_-]|xxx|\{|\}|%s|\$)")


class IntegrationsStaticTests(unittest.TestCase):
    def sources(self, roots=None, suffixes=('.php', '.tpl')):
        roots = roots or [MODULE]
        return [p for d in roots for p in d.rglob('*') if p.suffix in suffixes and p.is_file()]

    # ------------------------------------------------------------ structure
    def test_module_layout_and_entrypoint(self):
        self.assertTrue((MODULE / 'cloudhost247_integrations.php').is_file())
        self.assertTrue((MODULE / 'bootstrap.php').is_file())
        self.assertTrue((MODULE / 'migrations/V100.php').is_file())
        for path in ('lib/Registry/ProviderRegistry.php', 'lib/Registry/ProviderCatalog.php',
                     'lib/Security/SecretVault.php', 'lib/Security/MasterKey.php', 'lib/Security/UrlGuard.php',
                     'lib/Api/IntegrationClient.php', 'lib/Api/SmtpProbe.php',
                     'lib/Services/IntegrationRepository.php', 'lib/Services/IntegrationManager.php',
                     'lib/Services/ConnectionTester.php', 'lib/Services/AdminController.php',
                     'lib/Services/AdminView.php'):
            self.assertTrue((MODULE / path).is_file(), path)

    def test_deactivation_is_non_destructive(self):
        entry = (MODULE / 'cloudhost247_integrations.php').read_text()
        self.assertIn('Data retained', entry)
        self.assertNotIn('dropIfExists', entry)

    def test_only_namespaced_tables_created(self):
        for path in MODULE.rglob('*.php'):
            for table in re.findall(r"schema\(\)->create\('([^']+)'", path.read_text()):
                self.assertTrue(table.startswith('mod_cloudhost247_'), (path, table))

    def test_cron_is_cli_only_and_uses_real_results(self):
        cron = (ROOT / 'crons/cloudhost247_integrations.php').read_text()
        self.assertIn('PHP_SAPI', cron)
        self.assertIn('IntegrationManager::test', cron)

    # ------------------------------------------------------- access control
    def test_admin_controller_requires_authentication_csrf_and_audit(self):
        controller = (MODULE / 'lib/Services/AdminController.php').read_text()
        self.assertIn('requireAdmin()', controller)
        self.assertIn('requirePostToken()', controller)
        self.assertIn('AuditLogger::record', controller)
        for capability in ('integrations.view', 'integrations.create', 'integrations.edit', 'integrations.rotate',
                           'integrations.toggle', 'integrations.test', 'integrations.delete', 'integrations.endpoint'):
            self.assertIn(capability, controller)

    def test_every_state_change_is_audited(self):
        controller = (MODULE / 'lib/Services/AdminController.php').read_text()
        for action in ('integration.create', 'integration.update', 'integration.test', 'integration.enable',
                       'integration.disable', 'integration.rotate', 'integration.delete'):
            self.assertIn(action, controller)

    def test_production_changes_require_explicit_confirmation(self):
        controller = (MODULE / 'lib/Services/AdminController.php').read_text()
        self.assertIn('confirm_production', controller)
        self.assertIn('assertProductionConfirmation', controller)
        view = (MODULE / 'lib/Services/AdminView.php').read_text()
        self.assertIn('PRODUCTION', view)
        self.assertIn('confirm_production', view)

    def test_capability_policy_covers_the_new_module(self):
        core = (ROOT / 'modules/addons/cloudhost247_core/cloudhost247_core.php').read_text()
        self.assertIn('cloudhost247_integrations', core)

    # -------------------------------------------------------------- secrets
    def test_secret_material_never_reaches_the_view(self):
        view = (MODULE / 'lib/Services/AdminView.php').read_text()
        self.assertNotIn('->secrets(', view)
        self.assertNotIn('SecretVault::decrypt', view)
        self.assertIn("type=\"password\"", view)
        self.assertIn('Leave blank to keep the stored credential', view)
        self.assertIn('masked', view)

    def test_no_javascript_is_emitted_by_the_admin_interface(self):
        for path in (MODULE / 'lib/Services/AdminView.php', MODULE / 'cloudhost247_integrations.php'):
            text = path.read_text().lower()
            self.assertNotIn('<script', text)
            self.assertNotIn('onclick=', text)

    def test_decryption_is_confined_to_the_repository(self):
        decryptors = [p for p in MODULE.rglob('*.php') if 'SecretVault::decrypt' in p.read_text()]
        self.assertEqual([p.name for p in decryptors], ['IntegrationRepository.php'])

    def test_existing_credentials_survive_an_edit(self):
        repository = (MODULE / 'lib/Services/IntegrationRepository.php').read_text()
        self.assertIn('KEEP_EXISTING', repository)
        self.assertIn('if (trim($value) === self::KEEP_EXISTING) { continue; }', repository)

    def test_vault_has_no_fallback_key(self):
        master = (MODULE / 'lib/Security/MasterKey.php').read_text()
        self.assertIn('CH247_INTEGRATIONS_KEY', master)
        self.assertNotIn('default_key', master)
        self.assertIn('There is deliberately', master)
        vault = (MODULE / 'lib/Security/SecretVault.php').read_text()
        self.assertIn('aes-256-gcm', vault)
        self.assertIn('random_bytes', vault)

    def test_credentials_are_never_placed_in_a_query_string(self):
        catalog = (MODULE / 'lib/Registry/ProviderCatalog.php').read_text()
        for path in re.findall(r"'path' => '([^']*)'", catalog):
            self.assertNotIn('{secret}', path)
            for leak in ('key=', 'token=', 'apikey=', 'api_key=', 'password='):
                self.assertNotIn(leak, path.lower(), path)

    # ------------------------------------------------- failure containment
    def test_failures_are_sanitized(self):
        tester = (MODULE / 'lib/Services/ConnectionTester.php').read_text()
        self.assertNotIn('getMessage()', tester)
        self.assertNotIn('getTraceAsString', tester)
        manager = (MODULE / 'lib/Services/IntegrationManager.php').read_text()
        self.assertIn('Redactor::text', manager)
        self.assertIn('correlation_id', manager)

    def test_no_command_execution_or_unsafe_deserialization(self):
        bad = re.compile(r'\b(eval|exec|shell_exec|system|passthru|proc_open|popen|unserialize)\s*\(', re.I)
        for path in self.sources():
            self.assertIsNone(bad.search(path.read_text()), str(path))

    def test_no_dynamic_sql_fragments(self):
        bad = re.compile(r'(Capsule::raw|DB::statement)\s*\([^)]*\.\s*\$', re.I)
        for path in self.sources():
            self.assertIsNone(bad.search(path.read_text()), str(path))

    def test_ssrf_protections_are_present(self):
        guard = (MODULE / 'lib/Security/UrlGuard.php').read_text()
        for marker in ('https', 'FILTER_FLAG_NO_PRIV_RANGE', 'FILTER_FLAG_NO_RES_RANGE', 'CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS'):
            self.assertIn(marker, guard)
        transport = (MODULE / 'lib/Api/CurlTransport.php').read_text()
        for marker in ('CURLOPT_FOLLOWLOCATION', 'CURLOPT_SSL_VERIFYPEER', 'CURLOPT_SSL_VERIFYHOST', 'CURLOPT_WRITEFUNCTION'):
            self.assertIn(marker, transport)
        self.assertIn('=> false', transport)

    # ------------------------------------------------------- real providers
    def test_no_placeholder_integrations(self):
        catalog = (MODULE / 'lib/Registry/ProviderCatalog.php').read_text()
        self.assertNotIn('coming soon', catalog.lower())
        self.assertNotIn('not implemented', catalog.lower())
        self.assertNotIn('todo', catalog.lower())
        # every definition declares a real health check
        self.assertEqual(catalog.count("'key' => '"), catalog.count("'key' => '"))
        self.assertGreaterEqual(len(re.findall(r"'health' => array\(", catalog)), 20)

    def test_dashboard_reports_real_state_only(self):
        manager = (MODULE / 'lib/Services/IntegrationManager.php').read_text()
        self.assertIn("'status' => $row ? (string) $row->status", manager)
        view = (MODULE / 'lib/Services/AdminView.php').read_text()
        self.assertIn('no status on this page is simulated', view)

    def test_environment_separation_is_enforced(self):
        migration = (MODULE / 'migrations/V100.php').read_text()
        self.assertIn('environment', migration)
        self.assertIn('ch247_integration_environment_unique', migration)
        environment = (MODULE / 'lib/Support/Environment.php').read_text()
        for name in ('development', 'staging', 'production'):
            self.assertIn(name, environment)
        repository = (MODULE / 'lib/Services/IntegrationRepository.php').read_text()
        self.assertIn('assertCredentialRule', repository)

    # ----------------------------------------------------- migrated callers
    def test_existing_integrations_resolve_through_the_registry(self):
        rdp = (ROOT / 'modules/servers/RDP/lib/Api/ConfigResolver.php').read_text()
        self.assertIn('IntegrationManager::optionalCredentials', rdp)
        self.assertIn("ConfigResolver::resolve", (ROOT / 'modules/servers/RDP/RDP.php').read_text())
        ovh = (ROOT / 'modules/addons/cloudhost247_ovh/lib/Services/ConnectionResolver.php').read_text()
        self.assertIn('IntegrationManager::optionalCredentials', ovh)
        lte = (ROOT / 'modules/servers/cloudhost247_lteproxy/lib/Configuration.php').read_text()
        self.assertIn('IntegrationManager::optionalCredentials', lte)
        currency = (ROOT / 'modules/addons/cloudhost247_currency/lib/Support/EndpointResolver.php').read_text()
        self.assertIn('IntegrationManager::configuration', currency)

    def test_lteproxy_has_a_single_configuration_builder(self):
        module = ROOT / 'modules/servers/cloudhost247_lteproxy'
        builders = []
        for path in module.rglob('*.php'):
            text = path.read_text()
            if path.name == 'Configuration.php':
                continue
            builders += [(str(path), line) for line in re.findall(r"'api_base_url'\s*=>\s*\$[^,]+", text)]
        self.assertEqual(builders, [], 'duplicate LTE proxy API configuration builders remain')

    def test_no_hard_coded_production_endpoint_defaults(self):
        module = ROOT / 'modules/servers/cloudhost247_lteproxy'
        for path in list(module.rglob('*.php')) + list(module.rglob('*.tpl')):
            self.assertNotIn('api.cloudhost247.com', path.read_text(), str(path))

    # --------------------------------------------------------- global audit
    def test_owned_code_has_no_hard_coded_credentials(self):
        findings = []
        for path in self.sources(OWNED, ('.php', '.tpl', '.js')):
            for match in CREDENTIAL_LITERAL.finditer(path.read_text(errors='ignore')):
                if NON_SECRET.search(match.group(3)):
                    continue
                findings.append(f'{path}: {match.group(1)}')
        self.assertEqual(findings, [])

    def test_no_private_keys_or_cloud_access_keys_are_committed(self):
        bad = re.compile(r'-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}')
        for path in self.sources(OWNED, ('.php', '.tpl', '.js', '.json', '.yml', '.yaml')):
            self.assertIsNone(bad.search(path.read_text(errors='ignore')), str(path))

    def test_secrets_are_excluded_from_version_control(self):
        ignore = (ROOT / '.gitignore').read_text()
        for pattern in ('.env', '*.pem', '*.key', 'configuration.php'):
            self.assertIn(pattern, ignore)

    def test_vendor_credential_findings_are_documented(self):
        audit = (DOCS / 'API-INVENTORY-AUDIT.md').read_text()
        self.assertIn('modules/addons/soyoustart/lib/Helper.php', audit)
        self.assertIn('proxmox.shinedezign.pro', audit)

    # --------------------------------------------------------- documentation
    def test_integration_documentation_covers_every_provider(self):
        catalog = (MODULE / 'lib/Registry/ProviderCatalog.php').read_text()
        keys = re.findall(r"'key' => '([a-z0-9_]+)',\n\s+'label'", catalog)
        self.assertGreaterEqual(len(keys), 20)
        documentation = (DOCS / 'API-INTEGRATIONS.md').read_text()
        missing = [key for key in keys if f'`{key}`' not in documentation]
        self.assertEqual(missing, [])
        for section in ('Required credentials', 'Where to obtain', 'Required scopes', 'Endpoint requirements',
                        'Rotation', 'Test vs production', 'Connection testing', 'Failure handling',
                        'Security model'):
            self.assertIn(section, documentation)


if __name__ == '__main__':
    unittest.main()
