"""The page inventory has to answer a reviewer's questions, and be re-derivable.

`scripts/audit-navigation-inventory.py` writes the table the rebuild is reviewed against. Two things
about it were worth pinning before trusting a number in it:

1. **It did not cover the pages that are not root `*.php` files.** The tools surface (`/tools`,
   `/tools/category/…`, and every tool page) and the routes the licensed platform serves
   (`cart.php`, `clientarea.php`, `knowledgebase.php`, …) were in the navigation and in the sitemaps
   but in no row of the inventory, so a count of "pages" counted 84 files and none of them.
2. **A row said the page existed; nothing said which runtime serves it.** The tools catalogue the
   *platform* publishes is wider than the catalogue the *PHP* shell implements, and the first version
   of this suite read that difference the obvious way: routes only the platform lists were recorded
   as `platform-app`, `reachable: false`, no canonical. That was wrong. `tools/index.php` resolves
   through *two* catalogues — the native one and the theme projection it falls through to — and
   answers the second with an honest noindex signpost page, so about two dozen routes were marked
   unreachable while a visitor could reach every one of them. The split that measurement supports is
   working page / signpost / 301 alias, and the rows now say which.

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
    'cloudhost247-theme', 'whmcs-core', 'tools-front-controller', 'internal', 'unregistered',
}
IMPLEMENTATION_STATUSES = {
    'published', 'published tool route', 'platform signpost route', 'redirect alias',
    'platform entry point', 'internal', 'unregistered',
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
        # platform, so it is reachable and still has no canonical address here.
        for row in self.rows:
            if row['implementation_status'] == 'platform entry point':
                self.assertEqual('', row['canonical_url'],
                                 f"{row['php_page']} claims an address this site does not serve")

    def test_a_redirect_alias_canonicalises_to_its_target(self):
        # A 301 alias is a public URL, not a page: its canonical address is the tool's, and the tool
        # it points at has to be a page this inventory also lists, or the redirect lands on a 404.
        aliases = self.rows_where(implementation_status='redirect alias')
        self.assertTrue(aliases, 'no redirect alias rows: the front controller answers legacyPaths')
        paths = {row['path'] for row in self.rows}
        for row in aliases:
            self.assertNotEqual(row['path'], row['canonical_url'], row['php_page'])
            self.assertIn(row['canonical_url'], paths, f"{row['path']} → {row['canonical_url']}")
            self.assertEqual('redirects (301)', row['seo_status'], row['php_page'])
            self.assertTrue(row['reachable'], row['php_page'])

    def test_a_signpost_route_says_it_is_a_signpost(self):
        # The tool routes the PHP shell answers from the theme projection render a noindex page that
        # hands over to the platform. Recording them as ordinary published tools would overstate what
        # a visitor gets; recording them as unreachable, which this suite used to do, understates it.
        signposts = self.rows_where(implementation_status='platform signpost route')
        self.assertTrue(signposts, 'no signpost rows: the shell falls through to the theme catalogue')
        for row in signposts:
            self.assertEqual('tools-front-controller', row['route_owner'], row['php_page'])
            self.assertEqual('noindex signpost', row['seo_status'], row['php_page'])
            self.assertTrue(row['reachable'], row['php_page'])
            self.assertEqual(f"/{row['path'].lstrip('/')}", row['canonical_url'], row['php_page'])

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

    def test_dangling_redirects_and_duplicate_canonicals_are_reported(self):
        # Both are silent index failures: a 301 that lands on a 404 loses the visitor, and two pages
        # naming one canonical address drops one of them from the index with no error anywhere.
        self.assertEqual([], self.report['defects']['dangling_redirect_targets'])
        self.assertEqual([], self.report['defects']['duplicate_canonical_addresses'])

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

    def test_every_tool_route_is_classified_by_the_catalogue_that_answers_it(self):
        entries = inventory.tool_entries()
        # 265 routes: 135 from the native catalogue plus the 130 the theme projection adds. The set is
        # compared against what the front controller actually answers wherever PHP is available
        # (`scripts/verify-rendered-site.sh`), so what is pinned here is the shape of the derivation.
        self.assertGreater(len(entries), 200)
        for route, entry in entries.items():
            self.assertTrue(route == 'tools' or route.startswith('tools/'), route)
            self.assertIn(entry['surface'], {'native', 'signpost', 'redirect'}, route)
            if entry['surface'] == 'redirect':
                self.assertEqual('/' + entry['redirect_to'].lstrip('/'), entry['redirect_to'], route)
                self.assertNotEqual(entry['redirect_to'], '/' + route, route)

    def test_a_route_only_the_theme_projection_knows_is_a_signpost_not_a_404(self):
        # The defect this case exists for: `/tools/business-tools` is in the shared registry's Tools
        # menu and footer, the platform routes it, and `Catalog::resolve()` returns null for it. It
        # was recorded here as unreachable. It is answered by `Theme\ToolsSite::resolve()`, and the
        # front controller renders the signpost page for it rather than a 404.
        entries = inventory.tool_entries()
        self.assertIn('tools/business-tools', entries)
        self.assertEqual('signpost', entries['tools/business-tools']['surface'])
        for route in ('tools/ip-lookup', 'tools/spf-checker', 'tools/subnet-calculator',
                      'tools/json-tools'):
            self.assertIn(route, entries, route)
            self.assertIn(entries[route]['surface'], {'native', 'signpost'}, route)

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
