"""Contracts for the public number-service page and its existing module."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class NumberStorefrontTest(unittest.TestCase):
    def test_whmcs_catalog_is_scoped_and_respects_toggle(self):
        route = (ROOT / 'number-services.php').read_text()
        for part in ("Config::isServiceEnabled('numbers')", "where('p.servertype', 'phoneservices_numbers')", "where('p.hidden', 0)", "where('g.hidden', 0)", 'WhmcsDataSource'):
            self.assertIn(part, route)

    def test_order_and_empty_states(self):
        template = (ROOT / 'templates/cloudhost247/number-services.tpl').read_text()
        for part in ('$plan.order_url|escape', '$numberError|escape', 'No number plans are published', 'index.php?m=phoneservices&amp;action=numbers'):
            self.assertIn(part, template)
        self.assertNotIn('visual3d', template)

    def test_menu_and_footer_link_both_surfaces(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'number-services.php' and item['href'].get('spa') == '/number-services' for item in links))

if __name__ == '__main__':
    unittest.main()
