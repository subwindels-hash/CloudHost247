"""The cart skin must carry the site's palette, not a second one.

`templates/orderforms/cloudhost247` is a child of WHMCS `standard_cart`: the parent owns
the markup and processing, and the child owns only `css/custom.css`. That file is small
enough to be read in a review, but it is also the one stylesheet nobody opens, which is
how it kept a blue primary (`#0756d8`) and a separate green (`#196947`) long after the
rest of the site moved to the shared tokens.

These assertions are about *colour provenance* and about the properties the child must
not break, not about pixels: the skin may change any surface, but it must not invent a
brand colour, and it must not hide a control the parent needs.
"""
import re
import unittest
from pathlib import Path


def split_selectors(selector_list: str) -> list:
    """Split a selector list on top-level commas only.

    `:where(a, button)` carries commas of its own; splitting on every comma would report the
    parts of one selector as three unscoped ones.
    """
    parts, depth, current = [], 0, ''
    for char in selector_list:
        if char == '(':
            depth += 1
        elif char == ')':
            depth = max(0, depth - 1)
        if char == ',' and depth == 0:
            parts.append(current)
            current = ''
            continue
        current += char
    parts.append(current)
    return [part.strip() for part in parts if part.strip()]

ROOT = Path(__file__).resolve().parents[2]
SKIN = ROOT / 'templates' / 'orderforms' / 'cloudhost247' / 'css' / 'custom.css'
CLIENT_SKIN = ROOT / 'templates' / 'orderforms' / 'cloudhost247' / 'theme.yaml'

# Colours the site retired. None of them may reach checkout again.
RETIRED_COLOURS = ('#0756d8', '#071b3d', '#0a1730', '#196947', '#12b886', '#1c64f2')


class CartSkinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = SKIN.read_text()
        cls.body = re.sub(r'/\*.*?\*/', '', cls.css, flags=re.S)

    def test_the_skin_is_a_standard_cart_child(self):
        self.assertRegex(CLIENT_SKIN.read_text(), r'parent:\s*standard_cart',
                         'the cart must keep inheriting the parent it does not ship')

    def test_the_retired_palette_is_gone(self):
        lowered = self.body.lower()
        for colour in RETIRED_COLOURS:
            self.assertNotIn(colour, lowered, f'the cart skin still paints {colour}')

    def test_colour_comes_from_a_shared_token_first(self):
        # Every brand-filled control must read the design-system variable, with the literal only
        # as a fallback for a parent page that loads without the site stylesheet.
        self.assertIn('var(--ch247-primary, #16704b)', self.body)
        self.assertIn('var(--ch-ink, #0c1c26)', self.body)
        self.assertIn('var(--ch-line, #dbe3e0)', self.body)

    def test_the_shared_scope_is_scoped_to_the_cart(self):
        # The skin is loaded on cart pages only, but a rule that leaves the cart scope would
        # restyle the client area it sits inside.
        scoped = [selector for selector in re.findall(r'([^{}]+)\{', self.body)
                  if not selector.strip().startswith('@')]
        offenders = []
        for selector_list in scoped:
            for selector in split_selectors(selector_list):
                selector = ' '.join(selector.split())
                if not selector:
                    continue
                if selector.startswith(('#order-standard_cart', '.product-info',
                                        '.product-configurable-options', '.view-cart-items',
                                        '.checkout', '.row-product-selection', '.field-container',
                                        '.checkout-security-msg', '.btn', '.form-control',
                                        ':where(', '*')):
                    continue
                offenders.append(selector)
        # The two media-query blocks repeat the same structural selectors; anything else is a leak.
        self.assertEqual([], offenders, 'the cart skin reaches outside the cart surface')

    def test_the_summary_states_its_own_text_colour(self):
        # Painting a background without a foreground is what made the totals unreadable.
        summary = re.search(r'#order-standard_cart \.order-summary\s*\{([^}]*)\}', self.body)
        self.assertIsNotNone(summary, 'the order summary block disappeared')
        declarations = summary.group(1)
        self.assertIn('background', declarations)
        self.assertIn('color', declarations)

    def test_accessibility_properties_are_retained(self):
        self.assertIn(':focus-visible', self.body)
        self.assertIn('prefers-reduced-motion', self.body)
        self.assertIn('overflow-wrap: anywhere', self.body)
        self.assertIn('overflow-x: auto', self.body)

    def test_the_child_never_hides_a_parent_control(self):
        self.assertNotRegex(self.body, r'display\s*:\s*none', 'checkout must not hide a parent control')
        self.assertNotRegex(self.body, r'visibility\s*:\s*hidden')


if __name__ == '__main__':
    unittest.main()
