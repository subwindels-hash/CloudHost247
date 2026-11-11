"""All domain-service hub routes are discoverable in both navigation and footer."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

class DomainNavigationTest(unittest.TestCase):
    def test_domain_routes_in_menu_and_footer(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        domain_menu = next(m for m in registry['menus'] if m['id'] == 'domains')
        menu = [item for col in domain_menu['columns'] for item in col['items']]
        footer = next(c['items'] for c in registry['footer'] if c['title'] == 'Domains')
        routes = ['/domains', '/domains/search', '/domains/bulk-search', '/domains/transfer',
                  '/domains/extensions', '/domains/auctions', '/domains/appraisal',
                  '/domains/club', '/domains/whois', '/domains/broker', '/dashboard/domains',
                  '/dashboard/dns', '/tools/dns-lookup', '/tools/dns-propagation',
                  '/tools/domain-dns-health', '/tools/dnskey-lookup', '/tools/category/dns-domains']
        for items in (menu, footer):
            for route in routes:
                self.assertTrue(any(item['href'].get('spa') == route for item in items), route)
            self.assertTrue(any(item['href'].get('php') == 'index.php?m=cloudhost247_broker' for item in items))
            self.assertTrue(any(item['href'].get('php') == 'tools/domain-whois' for item in items))
        # Features only implemented by the Node platform must not point to unrelated PHP pages.
        for label in ('Bulk Domain Search', 'Domain Auctions', 'Domain Appraisal', 'Discount Domain Club'):
            self.assertNotIn('php', next(item for item in menu if item['label'] == label)['href'])

    def test_generated_php_navigation_and_footer(self):
        site = json.loads((ROOT / 'modules/addons/cloudhost247_theme/resources/site.json').read_text())
        menu = next(m for m in site['navigation'] if m['title'] == 'Domains')
        menu_urls = [link['url'] for group in menu['groups'] for link in group['links']]
        footer = next(c for c in site['footer'] if c['title'] == 'Domains')
        footer_urls = [link['url'] for link in footer['links']]
        for urls in (menu_urls, footer_urls):
            self.assertIn('index.php?m=cloudhost247_broker', urls)
            self.assertIn('tools/domain-whois', urls)
            self.assertIn('cart.php?a=add&domain=transfer', urls)

if __name__ == '__main__':
    unittest.main()
