"""SMTP storefront uses the existing WHMCS provisioning module and catalog."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class SmtpStorefrontTest(unittest.TestCase):
    def test_whmcs_catalog_filters_visible_smtp_products(self):
        route = (ROOT / 'smtp-hosting.php').read_text()
        for text in ("where('p.servertype', 'Smtphosting')", "where('p.hidden', 0)", "where('p.retired', 0)", "where('g.hidden', 0)", 'WhmcsDataSource'):
            self.assertIn(text, route)

    def test_checkout_and_safe_states(self):
        tpl = (ROOT / 'templates/cloudhost247/smtp-hosting.tpl').read_text()
        for text in ('$plan.order_url|escape', '$smtpError|escape', 'No SMTP plans are published', 'depend on the selected plan and provider'):
            self.assertIn(text, tpl)
        self.assertNotIn('visual3d', tpl)

    def test_menu_and_footer_links(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'smtp-hosting.php' and item['href'].get('spa') == '/smtp-hosting' for item in links))

if __name__ == '__main__':
    unittest.main()
