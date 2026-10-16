"""The Tools menu and footer may only link where this installation actually serves.

The defect this suite exists for was invisible to every other check in the repository, and it was
found by reading the rendered HTML rather than the source:

* the Tools mega menu and the footer's Tools column are **enriched at runtime** from the platform's
  live catalogue (`GET /api/tools/navigation`), so both surfaces publish one tool list;
* that list is the *platform's*, and it is wider than the PHP tools shell's. It advertises
  `/tools/business-tools`, `/tools/ip-lookup`, `/tools/spf-checker`, `/tools/subnet-calculator` and
  `/tools/json-tools`, none of which `tools/index.php` can resolve;
* `templates/cloudhost247/js/site.js` resolves every link it appends against **this** origin.

So every PHP page's footer gained four 404s about a second after load. No static link audit can see
them: `scripts/site/check-links.mjs` reads source, `tests/website/check-fixtures.py` reads fixtures
without executing JavaScript, and the anchors do not exist in either.

The fix is a projection: `scripts/site/generate.mjs` writes the `/tools/...` paths the PHP shell
answers for into the theme registry, the theme publishes them as a data attribute, and the script
filters the live catalogue against them — failing closed, so a missing attribute leaves the
server-rendered menu standing rather than filling it with 404s.
"""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESOURCES = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources'
SITE_JSON = RESOURCES / 'site.json'
TOOLS_PUBLIC = RESOURCES / 'tools-public.json'
REGISTRY = ROOT / 'shared' / 'site' / 'registry.json'
SITE_JS = ROOT / 'templates' / 'cloudhost247' / 'js' / 'site.js'
SITE_PHP = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'lib' / 'Site.php'
NAV_TPL = ROOT / 'templates' / 'cloudhost247' / 'includes' / 'site-nav.tpl'
FOOTER_TPL = ROOT / 'templates' / 'cloudhost247' / 'includes' / 'site-footer.tpl'
GENERATOR = ROOT / 'scripts' / 'site' / 'generate.mjs'
PLATFORM_CATALOG = ROOT / 'cloudhost247-node' / 'src' / 'tools' / 'catalog.ts'

spec = importlib.util.spec_from_file_location(
    'audit_navigation_inventory', ROOT / 'scripts' / 'audit-navigation-inventory.py')
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


def python_served_paths() -> set[str]:
    """The same derivation as `phpServedToolPaths()` in the generator, written independently."""
    served, _ = inventory.tool_entries()
    return set(served)


def platform_footer_slugs() -> list[str]:
    source = PLATFORM_CATALOG.read_text()
    match = re.search(r'export const TOOLS_FOOTER = \[(.*?)\];', source, re.S)
    if not match:
        raise AssertionError('TOOLS_FOOTER is not declared in the platform catalogue')
    return re.findall(r"'([a-z0-9-]+)'", match.group(1))


class ServedToolProjectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = json.loads(SITE_JSON.read_text())
        cls.served = set(cls.site.get('toolsServed') or [])

    def test_the_registry_publishes_the_paths_the_shell_serves(self):
        self.assertTrue(self.served, 'site.json carries no toolsServed projection')
        self.assertEqual(sorted(self.served), self.site['toolsServed'],
                         'the projection must be stably ordered so the freshness diff is meaningful')

    def test_the_projection_matches_an_independent_derivation(self):
        # Two implementations of one rule: the generator (JavaScript) and the inventory (Python).
        # If they disagree, one of them is telling a page to link somewhere it cannot go.
        self.assertEqual(python_served_paths(), self.served)

    def test_the_hub_and_the_discovery_taxonomy_are_inside_the_projection(self):
        registry = json.loads(REGISTRY.read_text())
        self.assertIn('tools', self.served)
        for category in registry['toolsCategories']:
            self.assertIn(f"tools/category/{category['slug']}", self.served)

    def test_a_platform_only_tool_is_not_in_the_projection(self):
        # The documented example, named so a reader can see the shape of the rule.
        self.assertNotIn('tools/business-tools', self.served)
        self.assertIn('tools/mrz-generator', self.served)

    def test_the_theme_publishes_the_projection_to_the_browser(self):
        php = SITE_PHP.read_text()
        self.assertIn("'toolsServed' =>", php)
        self.assertIn("'toolsServedJson' =>", php)
        for template in (NAV_TPL, FOOTER_TPL):
            body = template.read_text()
            self.assertIn('data-ch-tools-served="{$ch247Site.toolsServedJson|escape}"', body,
                          f'{template.name} must publish the served set')

    def test_the_generator_is_what_writes_the_projection(self):
        generator = GENERATOR.read_text()
        self.assertIn('phpServedToolPaths', generator)
        self.assertIn('toolsServed', generator)


class RuntimeLinkFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = SITE_JS.read_text()
        cls.site = json.loads(SITE_JSON.read_text())
        cls.served = set(cls.site.get('toolsServed') or [])

    def test_every_injected_link_is_filtered_against_the_served_set(self):
        # The one place the catalogue becomes anchors. Everything else builds links to the
        # platform's own origin (`/apps/…`, `/servers/new`), which is a different surface.
        self.assertIn('servedHere(tool)', self.script)
        filter_line = next(line for line in self.script.splitlines() if 'const tools = data.tools.filter(' in line)
        self.assertIn('servedHere(tool)', filter_line)
        self.assertIn('const link = document.createElement', self.script)

    def test_the_filter_compares_paths_not_slugs(self):
        self.assertIn('servedTools.has(String(tool.path || \'\').replace(/^\\//, \'\'))', self.script)

    def test_the_filter_fails_closed(self):
        # A page whose registry predates this attribute, or whose attribute will not parse, must
        # keep the server-rendered menu rather than enrich it from an unknown catalogue.
        self.assertIn('return null;', self.script)
        self.assertIn('servedTools !== null &&', self.script)
        self.assertIn('} catch (_) { return null; }', self.script)

    def test_no_tool_link_is_built_outside_the_filtered_list(self):
        # `toolLink` is the only constructor of a `/tools/...` anchor. Both of its call sites pass
        # the binding `tool`: once inside a loop over `entries`, a slice of the filtered array, and
        # once over a `tools.find` lookup. Nothing reaches the live catalogue directly.
        calls = [line.strip() for line in self.script.splitlines()
                 if 'toolLink(' in line and 'function toolLink' not in line]
        self.assertEqual(2, len(calls), calls)
        self.assertIn('entries.forEach', calls[0])
        self.assertEqual('const link = toolLink(tool);', calls[1])
        self.assertIn("const tool = tools.find(row => row.slug === slug);", self.script)
        self.assertEqual(1, self.script.count('data.tools.filter('),
                         'the live catalogue must be filtered exactly once')


class PlatformOnlyFooterSlugTests(unittest.TestCase):
    """The exact defect, pinned as data.

    What matters is the *path* the script resolves, not the slug: the platform's `my-ip` points at
    `/tools/what-is-my-ip`, which this shell serves, while `ip-lookup`, `spf-checker`,
    `subnet-calculator` and `json-tools` point at paths it does not. Comparing slugs would report
    seven and be wrong about three of them.
    """

    # Measured 2026-10-16 against the platform catalogue this shell's footer is enriched from. When
    # the PHP catalogue gains or renames a tool this list changes, and that is a change to a
    # published footer, so it should be a deliberate edit here rather than a silent difference.
    KNOWN_UNSERVED_PATHS = {
        'tools/ip-lookup', 'tools/spf-checker', 'tools/subnet-calculator', 'tools/json-tools',
    }

    @classmethod
    def setUpClass(cls):
        cls.site = json.loads(SITE_JSON.read_text())
        cls.served = set(cls.site.get('toolsServed') or [])
        cls.footer_slugs = platform_footer_slugs()
        platform = json.loads((RESOURCES / 'tools.json').read_text())
        cls.platform_paths = {tool['slug']: (tool.get('path') or '').lstrip('/') for tool in platform['tools']}
        cls.php_footer_links = {
            link['url'] for column in cls.site['footer'] for link in column['links']
            if column['title'] == 'Tools'
        }

    def test_the_platform_footer_list_is_readable(self):
        self.assertGreaterEqual(len(self.footer_slugs), 5, self.footer_slugs)
        for slug in self.footer_slugs:
            self.assertIn(slug, self.platform_paths, f'{slug} is in the footer list but not the catalogue')

    def test_the_paths_this_shell_cannot_serve_are_exactly_the_documented_four(self):
        unserved = {self.platform_paths[slug] for slug in self.footer_slugs
                    if self.platform_paths[slug] not in self.served}
        self.assertEqual(self.KNOWN_UNSERVED_PATHS, unserved,
                         'the platform footer now resolves to a different set of paths this shell '
                         'cannot serve; update KNOWN_UNSERVED_PATHS deliberately')

    def test_the_server_rendered_php_footer_never_names_an_unserved_tool(self):
        for url in self.php_footer_links:
            if url.startswith('tools/') and url.count('/') == 1:
                self.assertIn(url, self.served,
                              f'the footer publishes {url}, which the shell does not serve')

    def test_the_php_footer_does_not_publish_a_platform_only_route(self):
        self.assertNotIn('tools/business-tools', self.php_footer_links)

    def test_each_unserved_path_has_a_served_equivalent_the_reader_can_use(self):
        # The four are not missing capabilities: the PHP catalogue names the same tools differently
        # (`ip-location-lookup`, `spf-record-checker`, `ip-subnet-calculator`, `json-beautifier`).
        # Recording that here is what stops "the footer dropped four links" from reading as a
        # capability the site lost.
        equivalents = {
            'tools/ip-lookup': 'tools/ip-location-lookup',
            'tools/spf-checker': 'tools/spf-record-checker',
            'tools/subnet-calculator': 'tools/ip-subnet-calculator',
            'tools/json-tools': 'tools/json-formatter',
        }
        for path, equivalent in equivalents.items():
            self.assertIn(equivalent, self.served, f'{path}: {equivalent} is no longer served either')


if __name__ == '__main__':
    unittest.main()
