"""Tests for `scripts/check-accessibility-contract.py`.

The contract script is a gate, so what matters is not that it passes today but that it fails when the
thing it guards is removed. Every rule therefore has a negative case here that feeds it the broken
markup or stylesheet it is supposed to reject, and a positive case that shows it does not fire on the
markup the site actually ships (an implicit `<label>` wrapper, an exempt parent-theme image, a
`min-width` that only applies above the tablet band).
"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('a11y', ROOT / 'scripts/check-accessibility-contract.py')
a11y = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a11y)


def fake_root(*, nav: str = None, header: str = None, css: str = None) -> Path:
    """A throwaway tree with the four files the shell rules read, so those rules can be tested alone."""
    root = Path(tempfile.mkdtemp())
    theme = root / 'templates' / 'cloudhost247'
    (theme / 'includes').mkdir(parents=True)
    (theme / 'css').mkdir(parents=True)
    (root / 'tools' / 'lib').mkdir(parents=True)
    (theme / 'header.tpl').write_text(header if header is not None else
                                      '<html lang="en"><head><meta name="viewport" content="width=device-width">'
                                      '</head><div id="ch-main"></div>')
    (theme / 'includes' / 'site-nav.tpl').write_text(nav if nav is not None else
        '<a class="ch-skip" href="#ch-main">Skip</a>'
        '<button class="ch-menu-toggle" aria-expanded="false" aria-controls="ch-navigation">Menu</button>'
        '<nav id="ch-navigation"><details class="ch-nav-item"><summary>Hosting</summary></details></nav>')
    (theme / 'includes' / 'site-footer.tpl').write_text('<footer class="ch-footer"></footer>')
    (theme / 'footer.tpl').write_text('')
    (theme / 'css' / 'site.css').write_text(css if css is not None else
        '.ch-site{overflow-x:clip}.ch-site img{max-width:100%}'
        '.ch-site :focus-visible{outline:3px solid #000}'
        '@media(prefers-reduced-motion:reduce){.ch-site *{animation:none}}'
        '@media(max-width:767px){.ch-wrap{width:100%}}@media(min-width:1200px){.ch-wrap{width:1200px}}')
    (root / 'tools' / 'lib' / 'View.php').write_text('<html lang="en"><meta name="viewport" content="width=device-width">')
    return root


class AccessibilityContractTests(unittest.TestCase):
    def test_contract_holds_on_the_repository(self):
        report = a11y.run(ROOT)
        self.assertEqual(report['problems'], [])
        self.assertGreater(report['counters']['controls'], 0)
        self.assertGreater(report['counters']['rules'], 0)

    def test_unlabelled_control_is_reported(self):
        problems = a11y.control_name_problems('<div><input type="search" placeholder="Find"></div>', 'x.tpl')
        self.assertTrue(any('accessible name' in problem for problem in problems), problems)

    def test_implicit_label_and_explicit_label_are_accepted(self):
        self.assertEqual(a11y.control_name_problems('<label>Search<input type="search"></label>', 'x.tpl'), [])
        self.assertEqual(a11y.control_name_problems('<label for="q">Search</label><input id="q">', 'x.tpl'), [])
        self.assertEqual(a11y.control_name_problems('<input aria-label="Search">', 'x.tpl'), [])
        self.assertEqual(a11y.control_name_problems('<input aria-labelledby="h"><span id="h">Search</span>', 'x.tpl'), [])
        self.assertEqual(a11y.control_name_problems('<input type="submit" value="Go">', 'x.tpl'), [])

    def test_image_without_alt_or_dimensions_is_reported(self):
        self.assertTrue(any('without alt' in problem
                            for problem in a11y.image_problems('<img src="/assets/images/cloudhost247/a.svg">', 'x.tpl')))
        self.assertTrue(any('width/height' in problem for problem in a11y.image_problems(
            '<img src="/assets/images/cloudhost247/a.svg" alt="A">', 'x.tpl')))
        self.assertEqual(a11y.image_problems(
            '<img src="/assets/images/cloudhost247/a.svg" alt="A" width="10" height="10">', 'x.tpl'), [])
        # The one image this repository does not own and cannot measure.
        self.assertEqual(a11y.image_problems('<img src="/assets/img/overlay-spinner.svg" alt="">', 'x.tpl'), [])

    def test_smarty_comments_are_not_markup(self):
        source = a11y.strip_smarty_comments('{* an example: <img> with no attributes *}<img src="x.svg" alt="">')
        self.assertNotIn('<img>\n', source)
        self.assertEqual(a11y.image_problems(source, 'x.tpl'), [])

    def test_undersized_touch_target_is_reported(self):
        rules = [('site.css', '.ch-menu-toggle', 'display:inline-flex;padding:2px 4px;font-size:12px')]
        problems = a11y.target_problems(rules)
        self.assertTrue(any('.ch-menu-toggle' in problem and 'below the 44px' in problem for problem in problems), problems)
        good = [('site.css', selector, 'min-height:%dpx' % minimum) for selector, (minimum, _) in a11y.TARGET_RULES.items()]
        self.assertEqual(a11y.target_problems(good), [])
        # A renamed class must not silently drop out of the contract.
        self.assertTrue(any('no shipped stylesheet styles it' in problem for problem in a11y.target_problems([])))

    def test_pseudo_class_narrowed_selector_still_counts(self):
        rules = [('site.css', '.ch-account>a:not(.ch-btn)', 'min-height:24px')]
        self.assertFalse(any('.ch-account>a' in problem for problem in a11y.target_problems(rules)))

    def test_every_qa_viewport_needs_a_media_query(self):
        problems = a11y.breakpoint_problems(set(), set())
        self.assertEqual(len(problems), len(a11y.QA_WIDTHS))
        # A tablet-only ladder leaves the phone and the wide desktop unstyleable.
        # A phone-only ladder leaves every desktop width unstyleable.
        problems = a11y.breakpoint_problems({479}, set())
        self.assertTrue(any('1920px' in problem for problem in problems), problems)
        self.assertTrue(any('768px' in problem for problem in problems), problems)
        self.assertFalse(any('320px' in problem for problem in problems), problems)
        # A ladder that spans the desktop is complete.
        self.assertEqual(a11y.breakpoint_problems({479, 767, 1024}, {1200, 1600}), [])

    def test_missing_skip_link_and_menu_state_are_reported(self):
        root = fake_root(nav='<button class="ch-menu-toggle">Menu</button><nav><div class="ch-nav-item"></div></nav>')
        problems = a11y.run(root)['problems']
        self.assertTrue(any('skip link' in problem for problem in problems), problems)
        self.assertTrue(any('aria-expanded' in problem for problem in problems), problems)
        self.assertTrue(any('does not say which element it controls' in problem for problem in problems), problems)
        self.assertTrue(any('not <details>/<summary>' in problem for problem in problems), problems)

    def test_skip_link_must_have_a_target(self):
        root = fake_root(nav='<a class="ch-skip" href="#nope">Skip</a>'
                             '<button class="ch-menu-toggle" aria-expanded="false" aria-controls="ch-navigation">Menu</button>'
                             '<nav id="ch-navigation"><details class="ch-nav-item"><summary>Hosting</summary></details></nav>')
        self.assertTrue(any('#nope' in problem for problem in a11y.run(root)['problems']))

    def test_aria_controls_must_point_at_something(self):
        root = fake_root(nav='<a class="ch-skip" href="#ch-main">Skip</a>'
                             '<button class="ch-menu-toggle" aria-expanded="false" aria-controls="ch-navigation">Menu</button>'
                             '<nav><details class="ch-nav-item"><summary>Hosting</summary></details></nav>')
        self.assertTrue(any('names an element that does not exist' in problem for problem in a11y.run(root)['problems']))

    def test_stylesheet_regressions_are_reported(self):
        root = fake_root(css='.ch-site{overflow-x:visible}')
        problems = a11y.run(root)['problems']
        self.assertTrue(any('clip horizontal overflow' in problem for problem in problems), problems)
        self.assertTrue(any('focus-visible' in problem for problem in problems), problems)
        self.assertTrue(any('prefers-reduced-motion' in problem for problem in problems), problems)
        self.assertTrue(any('constrains image width' in problem for problem in problems), problems)

    def test_gate_fails_loudly_when_it_inspects_almost_nothing(self):
        problems = a11y.run(fake_root())['problems']
        self.assertTrue(any('vacuous gate' in problem for problem in problems), problems[:5])

    def test_json_report_shape(self):
        report = a11y.run(ROOT)
        self.assertEqual(set(report), {'counters', 'max_widths', 'min_widths', 'problems'})
        self.assertTrue(json.dumps(report))


if __name__ == '__main__':
    unittest.main()
