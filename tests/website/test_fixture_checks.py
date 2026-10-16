"""Tests for `tests/website/check-fixtures.py`.

The rendered-fixture QA reported 122 "missing asset" failures for pages that were fine: it read a
whole `srcset` attribute (`scene-640.avif 640w, scene-960.avif 960w, …`) as one path, so every
`<picture>` in the theme looked like a broken image and the ten real findings underneath were buried.
These tests pin the parsing that fixed it — each candidate is checked individually, and a width
descriptor has to agree with the width in the filename — plus the end-to-end behaviour on a rendered
page, so the regression cannot come back and the checker still fails on a genuinely missing file.
"""
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault('CH247_FIXTURE_DIR', str(ROOT / 'tests' / 'website'))
spec = importlib.util.spec_from_file_location('check_fixtures', ROOT / 'tests' / 'website' / 'check-fixtures.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

PICTURE = (
    '<picture>'
    '<source type="image/avif" srcset="/assets/images/cloudhost247/hero/infrastructure-3d-640.avif 640w, '
    '/assets/images/cloudhost247/hero/infrastructure-3d-960.avif 960w" sizes="100vw">'
    '<img src="/assets/images/cloudhost247/hero/infrastructure.svg" width="660" height="520" alt="Scene">'
    '</picture>'
)

PAGE = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>Fixture page | CloudHost247</title>'
    '<meta name="description" content="A rendered fixture page whose description is long enough to pass.">'
    '<link rel="canonical" href="https://example.test/ch247-fixture-test.php">'
    '<meta property="og:url" content="https://example.test/ch247-fixture-test.php">'
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage",'
    '"name":"Fixture page","url":"https://example.test/ch247-fixture-test.php"}</script>'
    '<link rel="stylesheet" href="/templates/cloudhost247/css/site.css?v=1">'
    '<link rel="stylesheet" href="/templates/cloudhost247/css/design-system.css?v=1">'
    '</head><body class="ch-site ch-public">'
    '<header class="ch-header"></header>'
    '<main><h1>Fixture page</h1>' + PICTURE + '</main>'
    '<footer class="ch-footer"></footer></body></html>'
)


def render(fixtures: Path, markup: str) -> None:
    render_named(fixtures, 'ch247-fixture-test.php', markup)


def render_named(fixtures: Path, name: str, markup: str) -> None:
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / f'{name}.html').write_text(markup)


class FixtureCheckTests(unittest.TestCase):
    def run_check(self, fixtures: Path) -> tuple[int, str]:
        original = check.FIXTURES
        check.FIXTURES = fixtures
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
                code = check.main()
        finally:
            check.FIXTURES = original
        return code, buffer.getvalue()

    def test_srcset_is_a_candidate_list(self):
        self.assertEqual(
            check.srcset_candidates('/a-640.avif 640w, /a-960.avif 960w'),
            [('/a-640.avif', '640w'), ('/a-960.avif', '960w')],
        )
        self.assertEqual(check.srcset_candidates('/a.avif'), [('/a.avif', '')])
        self.assertEqual(check.srcset_candidates(''), [])

    def test_every_picture_candidate_is_a_reference(self):
        references = check.asset_references(PICTURE)
        self.assertEqual([url for url, _ in references], [
            '/assets/images/cloudhost247/hero/infrastructure-3d-640.avif',
            '/assets/images/cloudhost247/hero/infrastructure-3d-960.avif',
            '/assets/images/cloudhost247/hero/infrastructure.svg',
        ])
        self.assertEqual(references[0][1], '640w')

    def test_non_asset_urls_are_ignored(self):
        self.assertEqual(check.asset_references('<a href="/web-hosting.php">Hosting</a>'), [])
        self.assertEqual(check.asset_references('<img src="https://cdn.example.test/a.svg" alt="">'), [])

    def test_width_descriptor_must_match_the_filename(self):
        self.assertIsNone(check.descriptor_problem('/a-640.avif', '640w'))
        self.assertIsNone(check.descriptor_problem('/a-640.avif', ''))
        self.assertIsNone(check.descriptor_problem('/a-640.avif', '2x'))
        self.assertIn('does not match', check.descriptor_problem('/a-960.avif', '640w'))

    def test_rendered_picture_ladder_passes(self):
        fixtures = Path(tempfile.mkdtemp()) / 'fixtures'
        render(fixtures, PAGE)
        code, output = self.run_check(fixtures)
        self.assertEqual(code, 0, output)
        self.assertIn('well-formed', output)

    def test_a_missing_rung_still_fails(self):
        fixtures = Path(tempfile.mkdtemp()) / 'fixtures'
        render(fixtures, PAGE.replace('-960.avif 960w', '-956.avif 960w'))
        code, output = self.run_check(fixtures)
        self.assertEqual(code, 1, output)
        self.assertIn('missing asset', output)

    def test_a_swapped_descriptor_fails(self):
        fixtures = Path(tempfile.mkdtemp()) / 'fixtures'
        render(fixtures, PAGE.replace('-960.avif 960w', '-960.avif 640w'))
        code, output = self.run_check(fixtures)
        self.assertEqual(code, 1, output)
        self.assertIn('does not match', output)

    def test_repository_fixture_is_still_checked_by_the_release_gate(self):
        gate = (ROOT / 'scripts' / 'release-candidate-check.sh').read_text()
        self.assertIn('tests/website/test_fixture_checks.py', gate)


class CanonicalAddressTests(unittest.TestCase):
    """One negative case per canonical rule, so a rule that stops firing fails here rather than
    silently passing every page.

    The canonical address is the one claim a public page makes to a crawler that this checker can
    adjudicate without a browser: whether the address of record exists, is reachable, and is the
    same address the page gives Open Graph and its structured data.
    """

    def setUp(self):
        self.fixtures = Path(tempfile.mkdtemp()) / 'fixtures'
        self.check = FixtureCheckTests()

    def run_check(self, fixtures: Path) -> tuple[int, str]:
        return self.check.run_check(fixtures)

    def failing(self, markup: str) -> str:
        render(self.fixtures, markup)
        code, output = self.run_check(self.fixtures)
        self.assertEqual(code, 1, output)
        return output

    def test_the_reference_page_passes(self):
        render(self.fixtures, PAGE)
        code, output = self.run_check(self.fixtures)
        self.assertEqual(code, 0, output)

    def test_two_canonicals_fail(self):
        markup = PAGE.replace(
            '<link rel="canonical" href="https://example.test/ch247-fixture-test.php">',
            '<link rel="canonical" href="https://example.test/ch247-fixture-test.php">'
            '<link rel="canonical" href="https://example.test/web-hosting.php">',
        )
        render_named(self.fixtures, 'web-hosting.php', PAGE)
        self.assertIn('2 <link rel="canonical"> elements', self.failing(markup))

    def test_a_canonical_on_a_noindex_page_fails(self):
        markup = PAGE.replace('<meta name="viewport"', '<meta name="robots" content="noindex"><meta name="viewport"')
        self.assertIn('canonical URL on a noindex page', self.failing(markup))

    def test_a_relative_canonical_fails(self):
        self.assertIn('not an absolute http(s) URL', self.failing(PAGE.replace(
            'href="https://example.test/ch247-fixture-test.php"', 'href="/ch247-fixture-test.php"')))

    def test_two_origins_fail(self):
        # Two pages, each internally consistent, on two different hosts: the site is publishing
        # two addresses of record for one document set.
        failures = check.audit_canonical_urls(
            [
                ('index.php', 'https://example.test/'),
                ('web-hosting.php', 'https://staging.example.test/web-hosting.php'),
            ],
            [],
        )
        self.assertTrue(any('publishes canonicals on 2 origins' in failure for failure in failures), failures)

    def test_a_trailing_slash_fails(self):
        self.assertIn('trailing slash', self.failing(PAGE.replace(
            'href="https://example.test/ch247-fixture-test.php"', 'href="https://example.test/ch247-fixture-test.php/"')))

    def test_a_fragment_fails(self):
        self.assertIn('carries a fragment', self.failing(PAGE.replace(
            'href="https://example.test/ch247-fixture-test.php"', 'href="https://example.test/ch247-fixture-test.php#plans"')))

    def test_a_canonical_naming_an_unrendered_page_fails(self):
        failures = check.audit_canonical_urls(
            [('ch247-fixture-test.php', 'https://example.test/nowhere.php')], []
        )
        self.assertTrue(any('names a page this site does not render' in failure for failure in failures), failures)

    def test_a_crawl_policy_blocked_canonical_fails(self):
        registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
        blocked = check.audit_canonical_urls(
            [('site-search.php', 'https://example.test/site-search.php')], registry['sitemap']['excludePhp']
        )
        self.assertTrue(any('disallowed by the crawl policy entry' in failure for failure in blocked), blocked)
        self.assertIsNone(check.crawl_policy_blocks('/web-hosting.php', registry['sitemap']['excludePhp']))

    def test_an_og_url_mismatch_fails(self):
        self.assertIn('og:url', self.failing(PAGE.replace(
            '<meta property="og:url" content="https://example.test/ch247-fixture-test.php">',
            '<meta property="og:url" content="https://example.test/something-else.php">')))

    def test_a_missing_og_url_fails(self):
        self.assertIn('og:url', self.failing(PAGE.replace(
            '<meta property="og:url" content="https://example.test/ch247-fixture-test.php">', '')))

    def test_a_json_ld_url_mismatch_fails(self):
        self.assertIn('JSON-LD url', self.failing(PAGE.replace(
            '"url":"https://example.test/ch247-fixture-test.php"', '"url":"https://example.test/elsewhere.php"')))

    def test_two_pages_sharing_a_canonical_fail(self):
        render_named(self.fixtures, 'ch247-fixture-test.php', PAGE)
        render_named(self.fixtures, 'ch247-fixture-other.php', PAGE)
        code, output = self.run_check(self.fixtures)
        self.assertEqual(code, 1, output)
        self.assertIn('indexable pages claim the canonical', output)

    def test_the_real_theme_emits_all_three_from_one_value(self):
        # The rules above are only satisfiable if the theme writes canonical, og:url and the
        # JSON-LD url from the single `$ch247Site.canonical` value rather than three literals.
        head = (ROOT / 'templates/cloudhost247/includes/site-head.tpl').read_text()
        self.assertGreaterEqual(head.count('$ch247Site.canonical'), 2)
        site = (ROOT / 'modules/addons/cloudhost247_theme/lib/Site.php').read_text()
        self.assertIn("'canonical' =>", site)
        self.assertIn("'url' => $result['canonical']", site)

    def test_the_fixture_harness_sets_a_single_system_url(self):
        harness = (ROOT / 'tests/website/render-fixtures.php').read_text()
        self.assertIn("'systemurl' => 'https://example.test'", harness)


if __name__ == '__main__':
    unittest.main()
