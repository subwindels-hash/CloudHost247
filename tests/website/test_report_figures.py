"""The §26 report declares its figures in a form a check can contradict.

Why this exists: the first revision of `FINAL-REPORT-2026-10-16.md` said the page inventory had 255
rows. It had 356 — the figure was carried over from the previous pass, when the inventory stopped at
the native tools catalogue, and nothing in the repository could disagree with prose. A wrong number in
the one document a reviewer reads is exactly the failure the rest of this work is about, so the report
now publishes its figures as JSON under a marker and this suite recomputes every one of them from the
artefact that owns it.

The rule is closed in both directions: every key in the block must have a derivation here, so the
block cannot grow a number that nothing checks, and every derivation must agree, so a stale figure
fails the gate instead of surviving review.

Figures that need a rendered tree or a browser are deliberately **not** in the block — they are stated
with the command that produced them, in the report's verification table, and re-running that command
is the check.
"""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / 'docs' / 'website-rebuild' / 'FINAL-REPORT-2026-10-16.md'
INVENTORY = ROOT / 'docs' / 'website-rebuild' / 'page-inventory.json'
ROUTE_REPORT = ROOT / 'shared' / 'site' / 'generated' / 'route-report.json'
SITE_JSON = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / 'site.json'

BLOCK = re.compile(r'<!-- verified-figures -->\s*```json\s*(\{.*?\})\s*```', re.S)


def declared_figures() -> dict:
    match = BLOCK.search(REPORT.read_text())
    if not match:
        raise AssertionError('the report has no <!-- verified-figures --> block')
    return json.loads(match.group(1))


def inventory_status_counts() -> dict:
    rows = json.loads(INVENTORY.read_text())['pages']
    counts: dict[str, int] = {}
    for row in rows:
        status = row['implementation_status']
        counts[status] = counts.get(status, 0) + 1
    return counts


class ReportFigureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.figures = declared_figures()
        cls.inventory = json.loads(INVENTORY.read_text())
        cls.route_report = json.loads(ROUTE_REPORT.read_text())
        cls.site = json.loads(SITE_JSON.read_text())
        cls.statuses = inventory_status_counts()

    def derivation(self, key: str):
        """The tree's answer for one declared figure, or None when nothing derives it."""
        rows = self.inventory['pages']
        table = {
            'inventory_rows': lambda: len(rows),
            'pages_published': lambda: self.statuses.get('published', 0),
            'root_php_pages': lambda: self.inventory['totals']['root_php_pages'],
            'files_internal': lambda: self.statuses.get('internal', 0),
            'routes_tool_native': lambda: self.statuses.get('published tool route', 0),
            'routes_tool_signpost': lambda: self.statuses.get('platform signpost route', 0),
            'routes_tool_redirect_alias': lambda: self.statuses.get('redirect alias', 0),
            'routes_platform_entry_point': lambda: self.statuses.get('platform entry point', 0),
            'defect_classes_empty': lambda: sum(
                1 for entries in self.inventory['defects'].values() if entries == []),
            'tools_served_projection': lambda: len(self.site['toolsServed']),
            'registry_links': lambda: self.route_report['linksChecked'],
            'registry_spa_links': lambda: self.route_report['spaLinks'],
            'registry_php_links': lambda: self.route_report['phpLinks'],
            'mega_menus': lambda: self.route_report['menus'],
            'footer_columns': lambda: self.route_report['footerColumns'],
        }
        return table.get(key)

    def test_every_declared_figure_has_a_derivation(self):
        underived = sorted(key for key in self.figures if self.derivation(key) is None)
        self.assertEqual([], underived,
                         'these figures are declared in the report but nothing in this suite derives '
                         'them, so nothing would notice them going stale')

    def test_every_declared_figure_matches_the_tree(self):
        for key, declared in sorted(self.figures.items()):
            derive = self.derivation(key)
            if derive is None:
                continue  # reported by the test above
            self.assertEqual(derive(), declared, f'{key} in the report is not what the tree says')

    def test_the_registry_route_report_is_confirmed_by_its_own_source(self):
        """Derive the same three counts from `registry.json`, independently of the generator.

        `route-report.json` is written by `scripts/site/generate.mjs`, which is also the thing that
        validates the registry — so a count in it is the generator grading its own input. This walks
        the registry the way the generator does (menu and featured hrefs, every column item, every
        footer item, and the utility links, which carry `spa`/`php` directly rather than under an
        `href`) and checks the numbers the report publishes against the source itself.
        """
        registry = json.loads((ROOT / 'shared' / 'site' / 'registry.json').read_text())
        hrefs = []
        for menu in registry['menus']:
            if menu.get('href'):
                hrefs.append(menu['href'])
            if (menu.get('featured') or {}).get('href'):
                hrefs.append(menu['featured']['href'])
            for column in menu.get('columns', []):
                for item in column.get('items', []):
                    hrefs.append(item.get('href') or {})
        for column in registry['footer']:
            for item in column.get('items', []):
                hrefs.append(item.get('href') or {})
        for value in (registry.get('utility') or {}).values():
            hrefs.append(value)

        self.assertEqual(len(hrefs), self.figures['registry_links'])
        self.assertEqual(sum(1 for href in hrefs if href.get('spa')), self.figures['registry_spa_links'])
        self.assertEqual(sum(1 for href in hrefs if href.get('php')), self.figures['registry_php_links'])
        # Every destination has at least one surface; the generator fails the build otherwise, and
        # this is the same rule read from the registry rather than from its report.
        self.assertEqual([], [href for href in hrefs if not (href.get('spa') or href.get('php'))])

    def test_the_inventory_and_the_route_report_agree_with_each_other(self):
        # Two artefacts, two derivations of the same counts. Both are cited as evidence in the
        # report, so if they drift, one of them is telling a reader something the tree contradicts.
        totals = self.inventory['totals']
        self.assertEqual(self.route_report['phpPagesKnown'], totals['root_php_pages'])
        self.assertEqual(self.route_report['menus'], totals['mega_menus'])
        self.assertEqual(self.route_report['footerColumns'], totals['footer_columns'])
        self.assertEqual(totals['registered_public_pages'], self.statuses.get('published', 0))

    def test_the_report_cites_the_suites_it_claims(self):
        body = REPORT.read_text()
        for cited in ('tests/website/check-tools-resolution.php',
                      'scripts/verify-rendered-site.sh',
                      'scripts/release-candidate-check.sh',
                      'tests/website/test_tools_surface.py',
                      'tests/website/test_page_inventory.py'):
            self.assertIn(cited, body, f'the report claims work without naming {cited}')

    def test_the_gate_runs_this_suite(self):
        gate = (ROOT / 'scripts' / 'release-candidate-check.sh').read_text()
        self.assertIn('tests/website/test_report_figures.py', gate,
                      'the report figures are only checked if the gate runs them')

    def test_a_wrong_figure_would_fail(self):
        # The negative case: prove the comparison can fail, not just pass.
        self.assertNotEqual(255, self.figures['inventory_rows'],
                            'the figure this suite was written to catch is back')


if __name__ == '__main__':
    unittest.main()
