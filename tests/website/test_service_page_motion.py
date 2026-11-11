"""Service showcases use the shared accessible motion controller on both surfaces."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PAGES = {
    'rdp-hosting': 'RdpHostingPage', 'smm-services': 'SmmServicesPage',
    'number-services': 'NumberServicesPage', 'google-workspace': 'GoogleWorkspacePage',
    'office-365': 'Office365Page', 'digital-products': 'DigitalProductsPage',
    'proxy-services': 'ProxyServicesPage', 'smtp-hosting': 'SmtpHostingPage',
}
class ServicePageMotionTest(unittest.TestCase):
    def test_illustrations_and_cards_opt_in(self):
        for slug, component in PAGES.items():
            for path in (ROOT / 'templates/cloudhost247' / (slug + '.tpl'), ROOT / 'cloudhost247-node/frontend/src/pages' / (component + '.tsx')):
                text = path.read_text()
                self.assertIn('data-tilt-max="5"', text, str(path))
                self.assertIn('data-tilt-max="3"', text, str(path))
                self.assertIn('data-showcase-depth', text, str(path))

    def test_shared_motion_is_reduced_for_accessibility(self):
        css = (ROOT / 'shared/site/metals.css').read_text()
        js = (ROOT / 'shared/site/motion.js').read_text()
        self.assertIn('prefers-reduced-motion: reduce', css)
        self.assertIn('[data-showcase-depth] { animation: none !important', css)
        self.assertIn('(hover: hover) and (pointer: fine)', js)
        self.assertIn('window.cancelAnimationFrame(tiltFrame)', js)
        self.assertTrue((ROOT / 'templates/cloudhost247/css/metals.css').read_text().endswith(css))
        self.assertTrue((ROOT / 'templates/cloudhost247/js/motion.js').read_text().endswith(js))

if __name__ == '__main__': unittest.main()
