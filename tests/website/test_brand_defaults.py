"""The colours the product uses when nobody has chosen one.

A website is not only the theme's stylesheets. Three other things paint it:

* the **page builder** compiles a page from `StyleCompiler::DEFAULT_VARIABLES` when the page has
  no global-style record, and its own admin/editor screens are a first-party surface;
* the **theme settings** store supplies the banner and offer colours the legacy theme renders -
  those values are editable in the admin, but the defaults are what a fresh install shows;
* the **Node application** generates whole sites (`builders/templates.ts`, the AI providers) and
  logos (`logo-maker/catalog.ts`), and its inbox labels fall back to one colour when the caller
  supplies none.

Every one of those still opened on the pre-green palette (`#0756d8` / `#12b886` / `#0442a8`)
after the design system had moved on, because none of them is a stylesheet the theme palette test
looks at. A page built that way keeps the old colour for as long as it exists: generated content
outlives the theme that generated it, so the default is the most durable place a stale colour can
hide.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / 'modules' / 'addons' / 'cloudhost247_builder'
THEME = ROOT / 'modules' / 'addons' / 'cloudhost247_theme'
NODE = ROOT / 'cloudhost247-node' / 'src'

RETIRED = ('#0756d8', '#12b886', '#0442a8', '#071b3d', '#0a1730')

# Every brand colour the defaults are allowed to use, taken from shared/site/design-system.css.
BRAND = {
    'primary': '#16704b',
    'primary-dark': '#0f5338',
    'accent': '#7ff0b4',
}


def php_defaults(path: Path, opener: str) -> dict[str, str]:
    """The `'key' => 'value'` pairs of one PHP array literal, by its opening text."""
    text = path.read_text(encoding='utf-8')
    start = text.index(opener)
    end = text.index(');', start)
    return {
        key: value
        for key, value in re.findall(r"'([\w-]+)'\s*=>\s*'([^']*)'", text[start:end])
    }


class PageBuilderTests(unittest.TestCase):
    def test_page_builder_defaults_are_brand_tokens(self):
        defaults = php_defaults(
            BUILDER / 'lib' / 'Render' / 'StyleCompiler.php',
            'const DEFAULT_VARIABLES = array(',
        )
        expected = {
            'color-primary': BRAND['primary'],
            'color-primary-dark': BRAND['primary-dark'],
            'color-accent': BRAND['accent'],
            'color-success': BRAND['primary'],
            'color-background': '#f3f7f8',
            'color-border': '#dbe5e8',
            'color-muted': '#52646f',
        }
        for key, value in expected.items():
            with self.subTest(key=key):
                self.assertEqual(defaults.get(key), value,
                                 f'the builder default {key} is not the brand token')

    def test_the_builder_admin_and_editor_use_the_brand_palette(self):
        sheets = sorted((BUILDER / 'assets' / 'css').glob('*.css'))
        self.assertGreaterEqual(len(sheets), 3)
        files = sheets + [BUILDER / 'assets' / 'js' / 'editor.js']
        offenders = []
        for path in files:
            text = path.read_text(encoding='utf-8').lower()
            offenders += [f'{path.name}: {colour}' for colour in RETIRED if colour in text]
        self.assertEqual(
            offenders, [],
            'The builder is CloudHost247 software, and the pages it compiles are CloudHost247 '
            'pages; its admin and editor chrome must not paint the retired palette either.',
        )


class ThemeSettingsTests(unittest.TestCase):
    def test_theme_banner_and_offer_defaults_are_brand_tokens(self):
        defaults = php_defaults(
            THEME / 'lib' / 'ThemeRepository.php', "'brand_name' =>",
        )
        expected = {
            'banner_background_color': BRAND['primary'],
            'banner_button_background_color': BRAND['accent'],
            # Mint is a light surface: white text on it is unreadable, so the paired default is ink.
            'banner_button_text_color': '#0a1620',
            'offer_background_style_one_color': '#f3f7f8',
            'offer_hthree_style_one_background_color': '#f3f7f8',
            'offer_hthree_style_one_off_color': BRAND['accent'],
            'offer_style_one_close_button_background_color': BRAND['primary'],
            'offer_style_one_coupon_border_color': BRAND['primary'],
            'offer_style_one_coupon_code_color': BRAND['primary'],
            'offer_style_one_use_coupon_color': BRAND['primary'],
        }
        for key, value in expected.items():
            with self.subTest(key=key):
                self.assertEqual(defaults.get(key), value,
                                 f'the theme setting default {key} is not the brand token')


class NodeDefaultsTests(unittest.TestCase):
    def test_generated_site_defaults_are_brand_tokens(self):
        cases = {
            'builders/templates.ts': "palette: { primary: '#16704b', accent: '#7ff0b4' }",
            'builders/ai/llm-provider.ts':
                "theme: { primary: color(theme.primary, '#16704b'), "
                "accent: color(theme.accent, '#7ff0b4') }",
            'builders/ai/rules-provider.ts':
                "default: { primary: '#16704b', accent: '#7ff0b4' }",
            'inbox/inbox-service.ts': "input.color! : '#16704b';",
        }
        # `rules-provider.ts` is left out of the blanket scan on purpose: its per-industry
        # palettes are product variety, and one of them is blue for technology customers. Its
        # *default* is pinned above and the variety is pinned by the test below.
        blanket = {
            'builders/templates.ts',
            'builders/ai/llm-provider.ts',
            'inbox/inbox-service.ts',
        }
        for relative, expected in cases.items():
            with self.subTest(file=relative):
                text = (NODE / relative).read_text(encoding='utf-8')
                self.assertIn(expected, text)
                if relative not in blanket:
                    continue
                for colour in RETIRED:
                    self.assertNotIn(colour, text,
                                     f'{relative} still carries the retired brand colour {colour}')

    def test_industry_palettes_are_not_mistaken_for_the_brand_default(self):
        # `rules-provider.ts` gives a technology customer a blue palette on purpose. That is
        # product variety, not the CloudHost247 default; pinning it here stops a future sweep from
        # "fixing" it and stops the brand default from quietly reverting either.
        text = (NODE / 'builders' / 'ai' / 'rules-provider.ts').read_text(encoding='utf-8')
        self.assertIn("technology: { primary: '#0756d8', accent: '#22d3ee' }", text)


class LogoMakerTests(unittest.TestCase):
    def test_logo_maker_offers_the_current_brand_palette(self):
        text = (NODE / 'logo-maker' / 'catalog.ts').read_text(encoding='utf-8')
        self.assertIn(
            "{ slug: 'ch247-green', name: 'CloudHost247 green', primary: '#16704b', "
            "accent: '#7ff0b4', background: '#ffffff', text: '#0c1c26'",
            text,
        )
        self.assertNotIn("'ch247-blue'", text.replace("'ch247-blue': 'ch247-green'", ''),
                         'the catalogue still offers the retired brand slug as a choice')

    def test_a_logo_project_saved_under_the_old_slug_still_resolves(self):
        catalog = (NODE / 'logo-maker' / 'catalog.ts').read_text(encoding='utf-8')
        self.assertIn("const LEGACY_PALETTE_SLUGS: Record<string, string> = "
                      "{ 'ch247-blue': 'ch247-green' };", catalog)
        service = (NODE / 'logo-maker' / 'logo-service.ts').read_text(encoding='utf-8')
        # The alias must be resolved to the current slug on write, not stored again.
        self.assertIn('const requestedPalette = input.paletteSlug ? paletteBySlug(input.paletteSlug) : undefined;', service)
        self.assertIn('const palette = requestedPalette ? requestedPalette.slug', service)
        self.assertIn('patchPalette?.slug ?? null', service)


if __name__ == '__main__':  # pragma: no cover - manual runs
    unittest.main()
