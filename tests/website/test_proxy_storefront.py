"""Proxy storefront links to configured WHMCS products, without bypassing the Node gate."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class ProxyStorefrontTest(unittest.TestCase):
    def test_whmcs_catalog_filters_visible_proxy_products(self):
        route = (ROOT / 'proxy-services.php').read_text()
        for text in ("where('p.servertype', 'cloudhost247_lteproxy')", "where('p.hidden', 0)", "where('p.retired', 0)", "where('g.hidden', 0)", 'WhmcsDataSource'):
            self.assertIn(text, route)

    def test_checkout_and_safe_states(self):
        tpl = (ROOT / 'templates/cloudhost247/proxy-services.tpl').read_text()
        for text in ('$plan.order_url|escape', '$proxyError|escape', 'No proxy plans are published', 'depend on the configured provider'):
            self.assertIn(text, tpl)
        self.assertNotIn('visual3d', tpl)
        page = (ROOT / 'cloudhost247-node/frontend/src/pages/ProxyServicesPage.tsx').read_text()
        # The SPA renders this service line from the platform's published catalogue, exactly like
        # every other storefront. It used to carry a hardcoded "coming soon" block, which is a
        # promise the page cannot keep and a second ordering story beside the real one. An
        # unpublished product already gets an honest empty state inside ProductPlansSection.
        self.assertIn('<ProductPlansSection slug="proxy-services"/>', page)
        self.assertNotIn('coming soon', page.lower())

    def test_menu_and_footer_links(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(item['href'].get('php') == 'proxy-services.php' and item['href'].get('spa') == '/proxy-services' for item in links))

if __name__ == '__main__':
    unittest.main()
