"""The SSL storefront sells certificates from the live WHMCS catalogue.

A certificate page is a commerce page: it either shows a real product, its real
price and a working route into the cart, or it says that no plan is published.
These checks pin the query scope (certificate products only), the order link,
the safe empty/error states, and the navigation that reaches the page.
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROUTE = ROOT / 'ssl-certificate.php'
TEMPLATE = ROOT / 'templates/cloudhost247/ssl-certificate.tpl'


class SslStorefrontTest(unittest.TestCase):
    def test_route_reads_live_whmcs_certificate_products(self):
        route = ROUTE.read_text()
        for text in (
            "where('p.hidden', 0)",
            "where('p.retired', 0)",
            "where('g.hidden', 0)",
            "where('g.name', 'like', '%ssl%')",
            "orWhere('g.name', 'like', '%certificate%')",
            "orWhere('p.servertype', 'ssl')",
            'WhmcsDataSource',
            'CartLinks::product',
            "setTemplate('ssl-certificate')",
        ):
            self.assertIn(text, route)

    def test_route_no_longer_renders_an_unpublished_theme_entry(self):
        route = ROUTE.read_text()
        self.assertNotIn('PublicPage::route', route)
        self.assertNotIn("'ssl-certificate', 'SSL Certificates'", route)

    def test_template_renders_prices_and_checkout_links(self):
        template = TEMPLATE.read_text()
        for text in (
            '#ssl-plans',
            '$plan.name|escape',
            '$plan.price.formatted|escape',
            '$plan.billing_label|escape',
            '$plan.order_url|escape',
            '$sslError|escape',
            'No certificate plans are published right now',
            'Pricing for this certificate is confirmed at checkout',
            'Validation method, domain coverage, issuer and renewal terms',
        ):
            self.assertIn(text, template)

    def test_template_never_invents_a_price_or_a_certificate_authority(self):
        template = TEMPLATE.read_text()
        self.assertIn('visual="security/ssl"', template)
        for invented in ('Let’s Encrypt', "Let's Encrypt", 'DigiCert', 'Comodo', 'Sectigo', '$'):
            # `$` is only legitimate in Smarty expressions; a literal price is not.
            if invented == '$':
                self.assertNotIn('>$', template)
            else:
                self.assertNotIn(invented, template)

    def test_navigation_reaches_the_page_on_both_surfaces(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        menu = [item for m in registry['menus'] for col in m['columns'] for item in col['items']]
        footer = [item for col in registry['footer'] for item in col['items']]
        for links in (menu, footer):
            self.assertTrue(any(
                item['href'].get('php') == 'ssl-certificate.php'
                and item['href'].get('spa') == '/hosting/ssl'
                for item in links
            ))

    def test_page_styles_ship_with_the_theme(self):
        css = (ROOT / 'templates/cloudhost247/css/site.css').read_text()
        for rule in ('.ssl-hero', '.ssl-panel', '.ssl-cards', '.ssl-bottom'):
            self.assertIn(rule, css)


if __name__ == '__main__':
    unittest.main()
