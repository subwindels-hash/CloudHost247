from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'modules/addons/cloudhost247_modules'
DOCS = ROOT / 'docs/independent-rebuild'

PHP_SOURCES = sorted(p for p in MODULE.rglob('*.php') if p.is_file())


def strip_comments(text):
    """PHP source with block and line comments removed, so policy assertions
    match real code rather than the prose that documents it."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$', '', text)


class ModuleManagerStaticTests(unittest.TestCase):
    def source(self, relative):
        return (MODULE / relative).read_text()

    def code(self, relative):
        return strip_comments(self.source(relative))

    # ------------------------------------------------------------- structure
    def test_module_layout(self):
        for path in (
            'cloudhost247_modules.php', 'bootstrap.php', 'README.md', 'migrations/V100.php',
            'lib/Support/ModuleException.php', 'lib/Support/Version.php', 'lib/Support/ModuleType.php',
            'lib/Support/Paths.php', 'lib/Support/Checksum.php',
            'lib/Manifest/Manifest.php',
            'lib/Package/UploadReceiver.php', 'lib/Package/ArchiveInspector.php',
            'lib/Package/PackageInspection.php', 'lib/Package/SecureExtractor.php', 'lib/Package/PackageStorage.php',
            'lib/Registry/ModuleRegistry.php', 'lib/Registry/ModuleRepository.php',
            'lib/Registry/CompatibilityChecker.php', 'lib/Registry/DependencyResolver.php',
            'lib/Install/InstallationPlan.php', 'lib/Install/InstallationTransaction.php', 'lib/Install/Installer.php',
            'lib/Security/CapabilityPolicy.php',
            'lib/Services/ModuleManager.php', 'lib/Services/AdminController.php', 'lib/Services/AdminView.php',
        ):
            self.assertTrue((MODULE / path).is_file(), path)

    def test_every_source_is_namespaced_and_guarded(self):
        for path in PHP_SOURCES:
            text = path.read_text()
            if path.parent == MODULE:
                self.assertIn("defined('WHMCS')", text, str(path))
            else:
                self.assertRegex(text, r'namespace CloudHost247\\ModuleManager', str(path))

    def test_deactivation_is_non_destructive(self):
        entry = self.source('cloudhost247_modules.php')
        self.assertIn('Data retained', entry)
        self.assertNotIn('dropIfExists', entry)

    # ---------------------------------------------------- uploaded code safety
    def test_uploaded_packages_are_never_executed(self):
        """No uploaded file may be included, required, evaluated or shelled out to."""
        banned = re.compile(r'(?<![\w:>$])(eval|exec|shell_exec|system|passthru|proc_open|popen|pcntl_exec)\s*\(')
        for path in PHP_SOURCES:
            self.assertIsNone(banned.search(path.read_text()), str(path))

    def test_no_dynamic_include_of_installed_files(self):
        dynamic = re.compile(r'\b(include|include_once|require|require_once)\s*\(?\s*\$')
        for path in PHP_SOURCES:
            if path.name == 'bootstrap.php':
                continue
            self.assertIsNone(dynamic.search(path.read_text()), str(path))
        # The one dynamic require is the autoloader, and it only maps this
        # module's own namespace onto its own lib directory.
        bootstrap = self.source('bootstrap.php')
        self.assertIn("$prefix = 'CloudHost247\\\\ModuleManager\\\\'", bootstrap)
        self.assertIn("__DIR__ . '/lib/' . $relative . '.php'", bootstrap)
        self.assertEqual(bootstrap.count('require_once $'), 1)

    def test_manifests_are_decoded_as_data_only(self):
        manifest = self.source('lib/Manifest/Manifest.php')
        self.assertIn('json_decode', manifest)
        for banned in ('unserialize', 'yaml_parse', 'simplexml_load', 'call_user_func', 'create_function'):
            self.assertNotIn(banned, manifest)

    def test_archive_is_never_bulk_extracted(self):
        for path in PHP_SOURCES:
            text = path.read_text()
            self.assertNotIn('->extractTo(', text, str(path))
        extractor = self.source('lib/Package/SecureExtractor.php')
        self.assertIn('getStream', extractor)
        self.assertIn('Paths::containedPath', extractor)

    def test_every_write_is_containment_checked(self):
        extractor = self.source('lib/Package/SecureExtractor.php')
        self.assertLess(extractor.index('Paths::containedPath'), extractor.index("fopen"))
        self.assertIn('is_link', extractor)
        paths = self.source('lib/Support/Paths.php')
        for rule in ("'..'", "\\0", "[A-Za-z]:", 'realpath'):
            self.assertIn(rule, paths)

    def test_upload_validation_covers_type_size_and_checksum(self):
        receiver = self.source('lib/Package/UploadReceiver.php')
        for rule in ('is_uploaded_file', "'.zip'", 'ZIP_SIGNATURES', 'finfo', 'MIN_BYTES', 'maxBytes', 'Checksum::ofFile'):
            self.assertIn(rule, receiver)

    def test_archive_inspection_rejects_dangerous_structures(self):
        inspector = self.source('lib/Package/ArchiveInspector.php')
        for rule in ('MAX_ENTRIES', 'MAX_TOTAL_BYTES', 'MAX_ENTRY_BYTES', 'MAX_COMPRESSION_RATIO',
                     'MAX_PATH_LENGTH', 'MAX_DEPTH', 'symbolic link', 'setuid', 'encrypted',
                     'forbiddenExtensions', 'forbiddenSegments', 'duplicate'):
            self.assertIn(rule, inspector)
        for extension in ('phar', 'sh', 'so', 'exe', 'env', 'ini'):
            self.assertIn(f"'{extension}'", inspector)

    # -------------------------------------------------------------- authority
    def test_admin_controller_enforces_authentication_csrf_and_capabilities(self):
        controller = self.source('lib/Services/AdminController.php')
        self.assertIn('AdminGuard::requireAdmin()', controller)
        self.assertIn('AdminGuard::requirePostToken()', controller)
        for capability in ('modules.view', 'modules.upload', 'modules.install', 'modules.update',
                           'modules.toggle', 'modules.uninstall'):
            self.assertIn(capability, controller + self.source('lib/Security/CapabilityPolicy.php'))
        # Every state-changing operation requires a capability of its own.
        for operation in ('upload', 'install', 'toggle', 'uninstall', 'discard'):
            body = re.search(r'private function %s\(\$adminId\)\s*\{(.*?)\n    \}' % operation, controller, re.S)
            self.assertIsNotNone(body, operation)
            self.assertIn('requireCapability', body.group(1), operation)

    def test_privileged_capabilities_default_to_super_admin(self):
        policy = self.source('lib/Security/CapabilityPolicy.php')
        self.assertIn('SUPER_ADMIN_ROLE_NAMES', policy)
        self.assertIn('full administrator', policy)
        self.assertIn('seedDefaults', policy)
        self.assertIn('CapabilityPolicy::seedDefaults()', self.source('cloudhost247_modules.php'))

    def test_destructive_actions_require_explicit_confirmation(self):
        controller = self.source('lib/Services/AdminController.php')
        self.assertIn("confirm_install", controller)
        self.assertIn("confirm_downgrade", controller)
        self.assertIn("confirm_uninstall", controller)
        self.assertIn("confirm_module_id", controller)

    def test_client_ip_is_not_taken_from_untrusted_headers(self):
        controller = self.source('lib/Services/AdminController.php')
        self.assertIn('REMOTE_ADDR', controller)
        for header in ('HTTP_X_FORWARDED_FOR', 'HTTP_CLIENT_IP', 'HTTP_X_REAL_IP'):
            self.assertNotIn(header, controller)

    # ----------------------------------------------------------- data safety
    def test_nothing_drops_tables_or_customer_data(self):
        destructive = re.compile(r'->(drop|dropIfExists|truncate)\s*\(')
        for path in PHP_SOURCES:
            self.assertIsNone(destructive.search(path.read_text()), str(path))
        installer = self.source('lib/Install/Installer.php')
        self.assertIn('retained_tables', installer)

    def test_uninstall_removes_only_recorded_files(self):
        installer = self.source('lib/Install/Installer.php')
        self.assertIn('uninstallImpact', installer)
        self.assertIn('Paths::containedPath', installer)
        self.assertNotIn('rm -rf', installer)

    def test_installs_are_never_auto_enabled(self):
        repository = self.source('lib/Registry/ModuleRepository.php')
        self.assertIn("'enabled'] = false; // never auto-enable", repository)
        record = re.search(r'public function recordInstallation\(.*?\n    \}', repository, re.S).group(0)
        # The shared attribute set (used by the update branch) must not touch it.
        shared = record[:record.index('if ($existing)')]
        self.assertNotIn("'enabled'", shared)
        # Only the insert branch sets it, and only to false.
        self.assertEqual(record.count("'enabled'"), 1)

    def test_transaction_backs_up_before_writing(self):
        transaction = self.source('lib/Install/InstallationTransaction.php')
        for step in ('begin', 'clearDestination', 'markExtracted', 'commit', 'rollback', 'installation.json'):
            self.assertIn(step, transaction)
        installer = self.source('lib/Install/Installer.php')
        self.assertLess(installer.index('$transaction->begin('), installer.index('$this->extractor->extract('))
        self.assertIn('$transaction->rollback(', installer)

    # ------------------------------------------------------------- reporting
    def test_status_is_read_from_real_state(self):
        installer = self.source('lib/Install/Installer.php')
        self.assertIn('Checksum::matches', installer)
        self.assertIn("'healthy'", installer)
        view = self.source('lib/Services/AdminView.php')
        for fake in ('Installed successfully', 'Coming soon', 'demo mode'):
            self.assertNotIn(fake, view)

    def test_admin_view_escapes_output_and_emits_no_script(self):
        view = self.source('lib/Services/AdminView.php')
        self.assertIn("htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8')", view)
        self.assertNotIn('<script', view)
        self.assertNotIn('onclick', view)
        # No interpolated variables inside HTML strings; everything goes through e().
        self.assertIsNone(re.search(r"'[^']*<[a-z][^']*\$[a-zA-Z_]", view))

    def test_logs_never_record_secrets(self):
        for path in PHP_SOURCES:
            text = path.read_text()
            self.assertNotRegex(text, r"(?i)log[^\n]*\b(password|api_key|apikey|token|secret)\s*=>")

    def test_secret_configuration_is_delegated_to_the_vault(self):
        manifest = self.source('lib/Manifest/Manifest.php')
        self.assertIn('is marked secret', manifest)
        self.assertIn('API & Integrations vault', manifest)
        service = self.source('lib/Services/ModuleManager.php')
        self.assertIn('ProviderRegistry', service)
        self.assertIn('IntegrationManager', service)

    # ------------------------------------------------------------ migrations
    def test_migration_is_additive_and_namespaced(self):
        migration = self.source('migrations/V100.php')
        self.assertIn("return '1.0.0'", migration)
        tables = re.findall(r"->create\('([^']+)'", migration)
        self.assertEqual(sorted(tables), [
            'mod_cloudhost247_module_events', 'mod_cloudhost247_module_files',
            'mod_cloudhost247_module_packages', 'mod_cloudhost247_modules',
        ])
        self.assertEqual(migration.count('hasTable('), len(tables))

    def test_settings_migration_is_additive_and_holds_no_secrets(self):
        migration = self.source('migrations/V110.php')
        self.assertIn("return '1.1.0'", migration)
        tables = re.findall(r"->create\('([^']+)'", migration)
        self.assertEqual(tables, ['mod_cloudhost247_module_settings'])
        self.assertEqual(migration.count('hasTable('), 1)
        # V100 is immutable once released: the settings table arrives additively.
        self.assertNotIn('mod_cloudhost247_module_settings', self.source('migrations/V100.php'))

    def test_migration_registered_with_the_release_gate(self):
        validator = (ROOT / 'scripts/validate-migrations.py').read_text()
        self.assertIn("'cloudhost247_modules':['1.0.0','1.1.0']", validator)
        gate = (ROOT / 'scripts/release-candidate-check.sh').read_text()
        self.assertIn('tests/modules/run.php', gate)
        self.assertIn('tests/modules/test_static.py', gate)
        workflow = (ROOT / '.github/workflows/independent-foundation.yml').read_text()
        self.assertIn('tests/modules/run.php', workflow)

    # ------------------------------------------------- configuration safety
    def test_module_settings_can_never_hold_credentials(self):
        manifest = self.source('lib/Manifest/Manifest.php')
        # Secret by flag and secret by name are both refused before storage exists.
        self.assertIn('CREDENTIAL_KEY_PATTERN', manifest)
        for word in ('password', 'secret', 'token', 'key', 'credential', 'passphrase'):
            self.assertIn(word, manifest.split('CREDENTIAL_KEY_PATTERN')[1].split(';')[0])
        self.assertIn('looksLikeCredential', manifest)
        # The settings path has no notion of a secret: it cannot store, encrypt or mask one.
        settings = self.code('lib/Registry/ModuleSettings.php').lower()
        for forbidden in ('secret', 'encrypt', 'decrypt', 'vault', 'password'):
            self.assertNotIn(forbidden, settings)
        repository = self.code('lib/Registry/ModuleRepository.php')
        save = repository.split('public function saveSettings(')[1].split('public function')[0]
        self.assertIn('updateOrInsert', save)
        self.assertNotIn('manifest_json', save)

    def test_configuration_is_validated_against_the_manifest_only(self):
        controller = self.code('lib/Services/AdminController.php')
        configure = controller.split('private function configure(')[1].split('private function')[0]
        self.assertIn("requireCapability(self::MODULE, 'modules.configure')", configure)
        self.assertIn('ModuleSettings::validate($manifest', configure)
        # Only key names reach the log and the audit trail, never values.
        self.assertIn("implode(', ', $changed)", configure)
        logged = configure.split('$this->log(')[1].split(';')[0]
        self.assertNotIn('$validated', logged)
        audited = configure.split('$this->audit(')[1].split(';')[0]
        self.assertIn('array_keys($before)', audited)
        self.assertNotIn("$validated['values']", audited)

    def test_connection_testing_is_delegated_to_the_integrations_centre(self):
        service = self.code('lib/Services/ModuleManager.php')
        tester = service.split('public static function testIntegration(')[1].split('private static function')[0]
        self.assertIn('IntegrationManager::test(', tester)
        # The Module Manager never reads, holds or forwards credentials itself.
        for forbidden in ('secrets(', 'decrypt', 'password', 'api_key', 'MasterKey'):
            self.assertNotIn(forbidden, tester)

    # ------------------------------------------------------------ uninstall
    def test_uninstall_shows_and_enforces_real_customer_impact(self):
        census = self.code('lib/Registry/UsageCensus.php')
        for table in ('tblservers', 'tblproducts', 'tblhosting', 'tbldomains', 'tblpaymentgateways'):
            self.assertIn(table, census)
        # Counts only: no customer row or column is ever selected or read.
        for forbidden in ('->select(', '->get()', '->pluck(', 'firstname', 'lastname', 'email'):
            self.assertNotIn(forbidden, census)
        for destructive in ('->delete(', '->update(', '->insert(', 'Capsule::raw', 'DB::statement'):
            self.assertNotIn(destructive, census)
        # Unmeasurable means unknown, never a reassuring zero.
        self.assertIn('return null', census)
        self.assertIn("'Could not be measured: '", census)

        controller = self.code('lib/Services/AdminController.php')
        uninstall = controller.split('private function uninstall(')[1].split('private function')[0]
        self.assertIn("empty($_POST['confirm_usage'])", uninstall)
        self.assertIn("$usage['live'] === null", uninstall)

    # ----------------------------------------------------------- compliance
    def test_compliance_matrix_references_real_assertions(self):
        """The traceability matrix may only cite checks that actually exist."""
        doc = (DOCS / 'MODULE-MANAGER-COMPLIANCE.md').read_text()
        suite = (ROOT / 'tests/modules/run.php').read_text()
        static = (ROOT / 'tests/modules/test_static.py').read_text()
        names = set(re.findall(r"`([a-z][a-z0-9 ,\'\-/()]{15,})`", doc))
        self.assertGreater(len(names), 100, 'the matrix lost its evidence column')
        for name in sorted(names):
            if name.startswith('test_'):
                self.assertIn(f'def {name}', static, name)
            else:
                self.assertIn(name, suite, name)

    def test_compliance_matrix_covers_every_specification_section(self):
        doc = (DOCS / 'MODULE-MANAGER-COMPLIANCE.md').read_text()
        for heading in (
            '## 1. The page', '## 2. Upload pipeline', '## 3. Secure archive extraction',
            '## 4. Module manifest', '## 5. Installation preview', '## 6. Installation transaction',
            '## 7. Existing module protection', '## 8. Enable / disable', '## 9. Uninstall',
            '## 10. Module permissions', '## 11. Security / trust', '## 12. Module configuration',
            '## 13. Module updates', '## 14. Module audit log', '## 15. Not a fake UI',
            '## 16. Reusable platform service',
        ):
            self.assertIn(heading, doc)

    # ----------------------------------------------------------- deployment
    def test_storage_is_configurable_and_hardened(self):
        storage = self.source('lib/Package/PackageStorage.php')
        for rule in ('CH247_MODULE_STORAGE', '.htaccess', '0700', 'isInsideDocumentRoot', 'unavailableReason'):
            self.assertIn(rule, storage)

    def test_no_hardcoded_credentials_or_endpoints(self):
        urls = re.compile(r'https?://(?!(?:www\.)?(?:example|localhost))[a-z0-9.-]+', re.I)
        for path in PHP_SOURCES:
            self.assertEqual(urls.findall(path.read_text()), [], str(path))

    def test_packages_are_not_committed(self):
        ignore = (ROOT / '.gitignore').read_text()
        self.assertIn('*.zip', ignore)

    def test_documentation_describes_the_workflow(self):
        for document in (MODULE / 'README.md', DOCS / 'MODULE-MANAGER.md'):
            text = document.read_text()
            for section in ('Upload', 'Validate', 'Inspect', 'Compatibility', 'Dependency',
                            'Preview', 'Confirm', 'Backup', 'Install', 'Register', 'Enable', 'Health'):
                self.assertIn(section, text, f'{document}: {section}')

    def test_manifest_specification_is_documented(self):
        specification = (DOCS / 'MODULE-MANAGER.md').read_text()
        for key in ('"id"', '"version"', '"type"', '"entry_point"', '"min_php_version"',
                    '"dependencies"', '"permissions"', '"migrations"', '"configuration"', '"integrations"'):
            self.assertIn(key, specification)


if __name__ == '__main__':
    unittest.main()
