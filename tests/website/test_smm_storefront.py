"""Contract checks for SMM storefront navigation and module-backed products."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class SmmStorefrontTest(unittest.TestCase):
    def test_module_catalog_is_scoped_to_active_mappings(self):
        route = (ROOT / 'smm-services.php').read_text()
        for part in ("where('p.servertype', 'cloudhost247_smm')", "where('p.hidden', 0)", "where('g.hidden', 0)", "where('m.enabled', 1)", "where('s.available', 1)", "where('provider.enabled', 1)", "whereColumn('s.provider_id', 'm.provider_id')", 'WhmcsDataSource'):
            self.assertIn(part, route)
        self.assertNotIn('provider_cost', route.split('$rows =')[1].split('->get();')[0])

    def test_storefront_has_order_and_safe_empty_states(self):
        template = (ROOT / 'templates/cloudhost247/smm-services.tpl').read_text()
        for part in ('$service.order_url|escape', '$smmError|escape', 'Services are being prepared', 'See available pricing at checkout'):
            self.assertIn(part, template)
        self.assertNotIn('visual3d', template)

    def test_menu_and_footer_link_both_surfaces(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'smm-services.php' and item['href'].get('spa') == '/smm-services' for item in links))

if __name__ == '__main__':
    unittest.main()
