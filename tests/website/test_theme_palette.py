"""One palette across every stylesheet the theme ships.

The theme ships seven sheets, and they do not all arrive through `site-head.tpl`:

* `site.css` and `design-system.css` load on every public page, in that order;
* `custom.css` is a WHMCS convention sheet, loaded by the platform on every client-theme page
  (the client area, the cart, the account pages) **without** a template asking for it;
* `tools.css`, `email-hosting.css` and `announcementbar.css` load on the surfaces that need them;
* `auth.css` loads on the account pages.

`site.css`, `custom.css` and `announcementbar.css` each restate brand colours instead of reading
the design system's tokens, and because of when they load, a stale value there wins. That is how
the retired blue (`#0756d8`, `#071b3d`, `#12b886`) stayed live in the client area and in the
announcement bar long after the design system had moved to green, and how the older green
(`#196947`, `#b4f2cd`) survived in the tools shell.

These tests keep the palette single: shared tokens must agree, no sheet may paint a retired
colour, and the components that used to carry a literal must read the token instead.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
THEME = ROOT / 'templates' / 'cloudhost247'
STYLES = THEME / 'css'

# Every sheet in the theme, by the name the template links it under.
SHEETS = sorted(path.name for path in STYLES.glob('*.css'))

# Colours the design system retired. Blue was the pre-launch scheme; the two greens were an
# earlier pass at this palette, close enough to look like a rendering fault rather than a style.
RETIRED = (
    '#0756d8',  # brand blue
    '#071b3d',  # deep blue
    '#12b886',  # teal accent
    '#0a1730',  # blue-black
    '#196947',  # earlier green
    '#b4f2cd',  # earlier mint
    '#167b53',  # one-off focus green
)

# Tokens that must hold the same value wherever they are declared. `--ch247-font` is excluded:
# the design system aliases it (`var(--ch-font)`) while site.css restates the stack, and comparing
# the two strings would report a difference that resolves to the same font.
SHARED_TOKENS = (
    '--ch-ink', '--ch-navy', '--ch-paper', '--ch-soft', '--ch-line', '--ch-muted',
    '--ch-mint', '--ch-green',
    '--ch247-primary', '--ch247-accent', '--ch247-ink', '--ch247-bg', '--ch247-border',
)


def normalise(value: str) -> str:
    """Compare colours, not notation: `#fff` and `#ffffff` are the same paint."""
    value = value.strip().lower()
    if re.fullmatch(r'#[0-9a-f]{3}', value):
        return '#' + ''.join(character * 2 for character in value[1:])
    return value


def root_tokens(sheet: str) -> dict[str, str]:
    """The custom properties a sheet declares in its first `:root` block."""
    text = (STYLES / sheet).read_text(encoding='utf-8')
    block = re.search(r':root\s*\{([^}]*)\}', text)
    assert block is not None, f'{sheet} no longer declares a :root block'
    return {
        name: value.strip()
        for name, value in re.findall(r'(--[\w-]+)\s*:\s*([^;}]*)', block.group(1))
    }


class SharedTokenTests(unittest.TestCase):
    def test_site_and_design_system_agree_on_every_shared_token(self):
        design = root_tokens('design-system.css')
        site = root_tokens('site.css')
        mismatched = {
            token: (site[token], design[token])
            for token in SHARED_TOKENS
            if token in site and token in design
            and normalise(site[token]) != normalise(design[token])
        }
        self.assertEqual(
            mismatched, {},
            'site.css and design-system.css declare different values for the same token. The '
            'design system loads second and wins, so site.css is describing a palette the browser '
            'never paints; the two must move together.',
        )

    def test_the_client_area_sheet_carries_the_same_brand_tokens(self):
        # WHMCS loads custom.css itself, after the head. A different value here does not sit
        # behind the design system - it overrides it for every client-area page.
        custom = root_tokens('custom.css')
        design = root_tokens('design-system.css')
        for token in ('--ch247-primary', '--ch247-accent', '--ch247-width'):
            with self.subTest(token=token):
                self.assertEqual(normalise(custom.get(token, '')),
                                 normalise(design.get(token, '')))

    def test_the_design_system_is_the_only_sheet_that_withholds_the_font_stack(self):
        # Guards the exclusion above: if site.css ever stops restating the stack, the comparison
        # set should be revisited rather than silently left narrower than it claims.
        self.assertIn('--ch247-font', root_tokens('site.css'))


class RetiredColourTests(unittest.TestCase):
    def test_no_stylesheet_paints_a_retired_colour(self):
        offenders = []
        for sheet in SHEETS:
            text = (STYLES / sheet).read_text(encoding='utf-8').lower()
            offenders += [
                f'{sheet}: {colour}' for colour in RETIRED if colour in text
            ]
        self.assertEqual(
            offenders, [],
            'A theme stylesheet still paints a retired brand colour. Read the token '
            '(`var(--ch247-primary, #16704b)`) instead of copying the value; a literal here wins '
            'whenever this sheet loads after the design system, which is always for custom.css.',
        )

    def test_the_announcement_bar_reads_the_tokens(self):
        # It is included by header.tpl with its own <style> block, so it is the first thing a
        # visitor sees; it carried the blue gradient for as long as the rest of the site had left
        # it behind.
        markup = (THEME / 'includes' / 'announcementbar.tpl').read_text(encoding='utf-8')
        self.assertIn('--ab-bg-start: var(--ch-navy, #0a1620)', markup)
        self.assertIn('--ab-bg-mid: var(--ch-green, #16704b)', markup)
        self.assertIn('--ab-accent: var(--ch-mint, #7ff0b4)', markup)
        for colour in RETIRED:
            self.assertNotIn(colour, markup.lower())

    def test_the_components_that_had_a_literal_read_the_token(self):
        site = (STYLES / 'site.css').read_text(encoding='utf-8')
        tools = (STYLES / 'tools.css').read_text(encoding='utf-8')
        self.assertIn('--ch247-email-accent:var(--ch247-primary,#16704b)', site)
        self.assertIn('.ch247-email-eyebrow{color:var(--ch247-accent,#7ff0b4)}', site)
        self.assertIn('.ch-badge{display:inline-flex;align-items:center;border-radius:999px;'
                      'background:var(--ch-ok-soft,#e9f7ef);color:var(--ch247-primary,#16704b)',
                      tools)


if __name__ == '__main__':  # pragma: no cover - manual runs
    unittest.main()
