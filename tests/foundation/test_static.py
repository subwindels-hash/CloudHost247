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

    def test_theme_is_supported_child_and_cart(self):
        theme = (ROOT/'templates/cloudhost247/theme.yaml').read_text()
        cart = (ROOT/'templates/orderforms/cloudhost247/theme.yaml').read_text()
        self.assertIn('parent: twenty-one', theme)
        self.assertIn('parent: standard_cart', cart)

    def test_templates_escape_dynamic_plain_text(self):
        homepage = (ROOT/'templates/cloudhost247/homepage.tpl').read_text()
        page = (ROOT/'templates/cloudhost247/cloudhost247-page.tpl').read_text()
        self.assertIn('hero_title|escape', homepage)
        self.assertIn('title|escape', page)
        self.assertNotIn('$cloudhost247Page.title nofilter', page)

    def test_custom_route_uses_whmcs_client_area(self):
        route = (ROOT/'cloudhost247-page.php').read_text()
        self.assertIn("require __DIR__ . '/init.php'", route)
        self.assertIn('new ClientArea()', route)
        self.assertNotIn('session_start', route)

if __name__ == '__main__': unittest.main()
