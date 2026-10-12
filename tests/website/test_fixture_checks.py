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
    fixtures.mkdir(parents=True, exist_ok=True)
    (fixtures / 'ch247-fixture-test.php.html').write_text(markup)


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


if __name__ == '__main__':
    unittest.main()
