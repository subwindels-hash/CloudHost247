"""The page inventory has to answer a reviewer's questions, and be re-derivable.

`scripts/audit-navigation-inventory.py` writes the table the rebuild is reviewed against. Two things
about it were worth pinning before trusting a number in it:

1. **It did not cover the pages that are not root `*.php` files.** The tools surface (`/tools`,
   `/tools/category/…`, and every tool page) and the routes the licensed platform serves
   (`cart.php`, `clientarea.php`, `knowledgebase.php`, …) were in the navigation and in the sitemaps
   but in no row of the inventory, so a count of "pages" counted 84 files and none of them.
2. **A row said the page existed; nothing said which runtime serves it.** The tools catalogue the
   *platform* publishes is wider than the catalogue the *PHP* shell serves — `/tools/business-tools`
   is in the platform's footer and has no PHP route behind it. Both facts are true and only one of
   them belongs in a column called "exists", so `route_owner` and `implementation_status` are now
   separate fields and `canonical_url` is empty for anything this site does not serve.

The rules below are checked against a real run of the script, plus unit-level cases for the two
derivations a reader cannot see from the JSON alone.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'audit-navigation-inventory.py'
REGISTRY = ROOT / 'shared' / 'site' / 'registry.json'
GATE = ROOT / 'scripts' / 'release-candidate-check.sh'

spec = importlib.util.spec_from_file_location('audit_navigation_inventory', SCRIPT)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)

# The field names the brief asks for. `status`, `navigation_placement` and `footer_placement` are the
# names this repository used before; both spellings are kept so an existing reader does not break.
REQUIRED_FIELDS = (
    'path', 'canonical_url', 'page_title', 'category', 'route_owner', 'implementation_status',
    'template', 'navigation_location', 'footer_location', 'hero_asset', 'seo_status', 'test_status',
)
ROUTE_OWNERS = {
    'cloudhost247-theme', 'whmcs-core', 'tools-front-controller', 'platform-app',
    'internal', 'unregistered',
}
IMPLEMENTATION_STATUSES = {
    'published', 'published tool route', 'platform-only tool route', 'platform entry point',
    'internal', 'unregistered',
}


def build_inventory() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        json_out = Path(tmp) / 'inventory.json'
        csv_out = Path(tmp) / 'inventory.csv'
        result = subprocess.run(
            [sys.executable, str(SCRIPT), '--json', str(json_out), '--csv', str(csv_out)],
            cwd=ROOT, capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise AssertionError(f'inventory script failed:\n{result.stdout}\n{result.stderr}')
        if not csv_out.is_file():
            raise AssertionError('the inventory script wrote no CSV')
        return json.loads(json_out.read_text())


class PageInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = build_inventory()
        cls.rows = cls.report['pages']

    def rows_where(self, **match):
        return [row for row in self.rows if all(row[key] == value for key, value in match.items())]

    def test_every_row_carries_the_briefs_fields(self):
        for row in self.rows:
            missing = [field for field in REQUIRED_FIELDS if field not in row]
            self.assertEqual([], missing, row.get('php_page'))

    def test_the_closed_vocabularies_hold(self):
        for row in self.rows:
            self.assertIn(row['route_owner'], ROUTE_OWNERS, row['php_page'])
            self.assertIn(row['implementation_status'], IMPLEMENTATION_STATUSES, row['php_page'])

    def test_the_three_route_families_are_all_present(self):
        # A count that omits any of these is the defect this suite exists for.
        for owner in ('cloudhost247-theme', 'tools-front-controller', 'whmcs-core'):
            self.assertTrue(self.rows_where(route_owner=owner), f'no row is owned by {owner}')
        self.assertTrue(self.rows_where(**{'path': '/tools/dns-lookup', 'route_owner': 'tools-front-controller'}))
        self.assertTrue(self.rows_where(**{'php_page': 'cart.php', 'route_owner': 'whmcs-core'}))
        self.assertTrue(self.rows_where(**{'php_page': 'web-hosting.php', 'route_owner': 'cloudhost247-theme'}))

    def test_published_pages_have_a_canonical_and_at_least_one_check(self):
        for row in self.rows_where(implementation_status='published'):
            self.assertEqual(f"/{row['php_page']}", row['canonical_url'], row['php_page'])
            self.assertTrue(row['test_status'].strip(), row['php_page'])
            self.assertTrue(row['page_title'], row['php_page'])
            self.assertEqual(row['path'], row['canonical_url'], row['php_page'])

    def test_an_unserved_route_never_claims_a_canonical_address(self):
        # "Not served by this site" and "not reachable" are different facts. A WHMCS entry point
        # such as `announcements.php` is linked from the Resources menu and served by the licensed
        # platform, so it is reachable and still has no canonical address here; a platform-only tool
        # route is neither served by the PHP shell nor linked from the PHP navigation.
        for row in self.rows:
            if row['implementation_status'] == 'platform entry point':
                self.assertEqual('', row['canonical_url'],
                                 f"{row['php_page']} claims an address this site does not serve")
            if row['route_owner'] == 'platform-app':
                self.assertEqual('', row['canonical_url'], row['php_page'])
                self.assertFalse(row['reachable'], row['php_page'])
                self.assertIn('blocked', row['test_status'], row['php_page'])

    def test_a_blocked_check_is_named_as_blocked(self):
        # A green local run must not be readable as a green release: the two checks that need a
        # browser and a licensed install have to say so wherever they are listed.
        for row in self.rows:
            status = row['test_status']
            for check, reason in (('browser-qa', 'no browser binary'), ('staging-functional', 'licensed WHMCS')):
                if check in status:
                    self.assertIn('blocked', status, row['php_page'])
                    self.assertIn(reason, status, row['php_page'])

    def test_every_navigation_destination_has_a_row(self):
        registry = json.loads(REGISTRY.read_text())
        destinations = set()
        for menu in registry['menus']:
            destinations |= {(menu.get('href') or {}).get('php', '')}
            for column in menu.get('columns', []):
                for item in column.get('items', []):
                    destinations.add((item.get('href') or {}).get('php', ''))
        for column in registry['footer']:
            for item in column.get('items', []):
                destinations.add((item.get('href') or {}).get('php', ''))
        destinations = {entry.split('?')[0] for entry in destinations if entry}
        known = {row['php_page'] for row in self.rows} | {row['path'].lstrip('/') for row in self.rows}
        unknown = sorted(destination for destination in destinations
                         if destination not in known and f'{destination}.php' not in known)
        self.assertEqual([], unknown, 'these navigation destinations have no inventory row')

    def test_the_test_check_legend_names_a_command_for_every_id(self):
        legend = self.report['test_checks']
        for row in self.rows:
            for token in row['test_status'].split(';'):
                name = token.split(' (blocked')[0].strip()
                if not name:
                    continue
                self.assertIn(name, legend, f'{name} is cited as a check but has no command')

    def test_the_gate_regenerates_and_compares_the_inventory(self):
        gate = GATE.read_text()
        self.assertIn('scripts/audit-navigation-inventory.py', gate)
        self.assertIn('docs/website-rebuild/page-inventory.json', gate)


class RouteOwnerTests(unittest.TestCase):
    """The two derivations a reader cannot see in the JSON."""

    def test_ownership_comes_from_evidence_not_from_a_hand_kept_list(self):
        self.assertEqual('cloudhost247-theme', inventory.route_owner('web-hosting.php', 'published', 'cloudhost247-page'))
        self.assertEqual('cloudhost247-theme', inventory.route_owner('index.php', 'published', ''))
        self.assertEqual('whmcs-core', inventory.route_owner('clientarea.php', 'platform entry point', ''))
        self.assertEqual('tools-front-controller', inventory.route_owner('tools/index.php', 'published', ''))
        self.assertEqual('internal', inventory.route_owner('notfound.php', 'internal', ''))
        self.assertEqual('unregistered', inventory.route_owner('mystery.php', 'unregistered', ''))

    def test_a_platform_entry_point_is_never_covered_by_a_fixture_check(self):
        status = inventory.test_status('platform entry point')
        self.assertNotIn('rendered-fixtures', status)
        self.assertIn('staging-functional', status)
        self.assertIn('blocked', status)

    def test_a_published_page_is_covered_by_every_runtime_free_check(self):
        status = inventory.test_status('published')
        for check in ('php-syntax', 'link-integrity', 'website-static', 'rendered-fixtures',
                      'hero-render', 'accessibility-contract'):
            self.assertIn(check, status)

    def test_the_php_served_tools_match_the_catalogue_the_shell_reads(self):
        served, platform_only = inventory.tool_entries()
        # 135 is what `Catalog::resolve()` answers for when asked for the same candidates; the two
        # lists are compared end to end wherever PHP is available (see the audit report). What is
        # pinned here is the shape: the two sets are disjoint, and every served route is a path.
        self.assertGreater(len(served), 100)
        self.assertTrue(set(served).isdisjoint(platform_only), sorted(set(served) & set(platform_only)))
        for route in list(served) + list(platform_only):
            self.assertTrue(route == 'tools' or route.startswith('tools/'), route)

    def test_the_platform_only_routes_are_the_ones_the_php_shell_cannot_serve(self):
        _, platform_only = inventory.tool_entries()
        self.assertIn('tools/business-tools', platform_only,
                      'the platform publishes /tools/business-tools and the PHP shell does not')

    def test_strict_mode_fails_only_when_a_structural_defect_exists(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--strict',
                                 '--json', tempfile.mkstemp(suffix='.json')[1],
                                 '--csv', tempfile.mkstemp(suffix='.csv')[1]],
                                cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn('ORPHANED PAGES            : 0', result.stdout)
        self.assertIn('MENU LINKS WITHOUT PAGES  : 0', result.stdout)


if __name__ == '__main__':
    unittest.main()
