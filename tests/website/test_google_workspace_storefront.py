"""Public Google Workspace page uses the existing email module's catalog."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class GoogleWorkspaceStorefrontTest(unittest.TestCase):
    def test_module_catalog_filters_google_and_available(self):
        route = (ROOT / 'google-workspace.php').read_text()
        for text in ('CloudHost247\\Email\\Service\\PublicCatalog', 'byProvider($currencyId)', "$groups['google']['plans']", "$plan['available']", "$_SESSION['currency']"):
            self.assertIn(text, route)

    def test_checkout_empty_and_integration_scope(self):
        tpl = (ROOT / 'templates/cloudhost247/google-workspace.tpl').read_text()
        for text in ('$plan.cart_url|escape', '$workspaceError|escape', 'No Google Workspace plans are published', 'does not purchase subscriptions or seats'):
            self.assertIn(text, tpl)
        self.assertNotIn('visual3d', tpl)

    def test_menu_and_footer_links(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'google-workspace.php' and item['href'].get('spa') == '/google-workspace' for item in links))

if __name__ == '__main__':
    unittest.main()
