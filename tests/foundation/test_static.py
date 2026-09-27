from pathlib import Path
import re, unittest
ROOT = Path(__file__).resolve().parents[2]
MODULES = ['cloudhost247_core', 'cloudhost247_theme', 'cloudhost247_currency', 'cloudhost247_ovh']

class FoundationStaticTests(unittest.TestCase):
    def test_entrypoints_and_migrations_exist(self):
        for module in MODULES:
            self.assertTrue((ROOT/'modules/addons'/module/f'{module}.php').is_file())
        for module in MODULES[1:]:
            self.assertTrue((ROOT/'modules/addons'/module/'migrations/V100.php').is_file())

    def test_no_vendor_license_configuration_in_replacements(self):
        terms = re.compile(r'licenseNumtoactivate|CheckLicense|whmcsglobalservices|xtreme_currency_rates', re.I)
        for module in MODULES:
            for path in (ROOT/'modules/addons'/module).rglob('*.php'):
                self.assertIsNone(terms.search(path.read_text()), str(path))

    def test_deactivation_is_non_destructive(self):
        for module in MODULES:
            entry = (ROOT/'modules/addons'/module/f'{module}.php').read_text()
            self.assertNotIn('dropIfExists', entry)
            if module != 'cloudhost247_core': self.assertIn('Data retained', entry)

    def test_only_namespaced_tables_created(self):
        for module in MODULES:
            for path in (ROOT/'modules/addons'/module).rglob('*.php'):
                for table in re.findall(r"schema\(\)->create\('([^']+)'", path.read_text()):
                    self.assertTrue(table.startswith('mod_cloudhost247_'), (path, table))

if __name__ == '__main__': unittest.main()
