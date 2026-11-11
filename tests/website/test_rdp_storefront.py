"""Contract checks for the RDP storefront and its existing WHMCS integration."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RdpStorefrontTest(unittest.TestCase):
    def test_catalogue_is_scoped_to_visible_rdp_products(self):
        route = (ROOT / 'rdp-hosting.php').read_text()
        self.assertIn("where('p.servertype', 'RDP')", route)
        self.assertIn("where('p.hidden', 0)", route)
        self.assertIn("where('g.hidden', 0)", route)
        self.assertIn('WhmcsDataSource', route)
        self.assertIn("setTemplate('rdp-hosting')", route)

    def test_page_has_safe_empty_and_order_states(self):
        template = (ROOT / 'templates/cloudhost247/rdp-hosting.tpl').read_text()
        for text in ('#plans', '$rdpError|escape', '$plan.order_url|escape',
                     'Plans are being prepared', 'See available pricing at checkout'):
            self.assertIn(text, template)
        self.assertNotIn('visual3d', template)

    def test_navigation_exposes_the_php_page(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        links = [item for menu in registry['menus'] for col in menu['columns'] for item in col['items']]
        self.assertTrue(any(item['href'].get('php') == 'rdp-hosting.php' for item in links))


if __name__ == '__main__':
    unittest.main()
