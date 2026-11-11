"""Digital products storefront uses the addon mapping and WHMCS cart."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class DigitalProductsStorefrontTest(unittest.TestCase):
    def test_only_published_mapped_products_and_current_active_files(self):
        route = (ROOT / 'digital-products.php').read_text()
        for text in ('mod_digitalproducts_products as d', 'mod_digitalproducts_files as f', "'f.id', '=', 'd.current_file_id'", "'f.product_id', '=', 'd.id'", "where('d.status', 'active')", "where('f.status', 'active')", "where('p.hidden', 0)", "where('p.retired', 0)", "where('g.hidden', 0)", 'WhmcsDataSource'):
            self.assertIn(text, route)
        self.assertNotIn("'f.file_path'", route)
        self.assertNotIn("'f.storage_key'", route)

    def test_checkout_and_empty_states(self):
        tpl = (ROOT / 'templates/cloudhost247/digital-products.tpl').read_text()
        for text in ('$product.order_url|escape', '$digitalError|escape', 'No digital products are published', 'index.php?m=digitalproducts&amp;action=downloads'):
            self.assertIn(text, tpl)
        self.assertNotIn('visual3d', tpl)

    def test_navigation_links_both_surfaces(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'digital-products.php' and item['href'].get('spa') == '/digital-products' for item in links))

if __name__ == '__main__':
    unittest.main()
