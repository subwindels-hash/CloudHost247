"""Microsoft 365 storefront uses the existing email module's catalog."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class Office365StorefrontTest(unittest.TestCase):
    def test_module_catalog_filters_microsoft_and_available(self):
        route = (ROOT / 'office-365.php').read_text()
        for text in ('CloudHost247\\Email\\Service\\PublicCatalog', 'byProvider($currencyId)', "$groups['microsoft365']['plans']", "$plan['available']", "$_SESSION['currency']"):
            self.assertIn(text, route)

    def test_checkout_empty_and_integration_scope(self):
        tpl = (ROOT / 'templates/cloudhost247/office-365.tpl').read_text()
        for text in ('$plan.cart_url|escape', '$officeError|escape', 'No Microsoft 365 plans are published', 'does not purchase or renew subscriptions or seats'):
            self.assertIn(text, tpl)
        self.assertNotIn('visual3d', tpl)

    def test_menu_and_footer_links(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'office-365.php' and item['href'].get('spa') == '/office-365' for item in links))

if __name__ == '__main__':
    unittest.main()
