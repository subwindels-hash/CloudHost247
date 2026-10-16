"""The Tools menu and footer may only link where this installation actually serves.

The Tools mega menu and the footer's Tools column are **enriched at runtime** from the platform's
live catalogue (`GET /api/tools/navigation`), and `templates/cloudhost247/js/site.js` resolves every
anchor it appends against **this** origin. So a tool the platform advertises and this shell cannot
answer is a 404 on a customer-facing page — one no static link audit can see, because the anchor does
not exist until the browser makes it.

An earlier revision of this suite tried to fix that with a projection of the paths the shell serves,
and built that projection from the *native* catalogue alone (`tools-public.json`). It then asserted,
here, that `/tools/business-tools`, `/tools/ip-lookup`, `/tools/spf-checker`, `/tools/subnet-calculator`
and `/tools/json-tools` were unserved, and filtered them out of every page.

Measurement contradicted it. `tools/index.php` resolves through **two** catalogues and answers all
five:

  * `Catalog::resolve()` over `tools-public.json` renders the working tool;
  * when that returns nothing it falls through to `Theme\\ToolsSite::resolve()` over `tools.json`,
    which renders an honest noindex **signpost** — the tool's summary, the sentence that it runs in
    the platform application, and a link into it — and answers a `legacyPaths` alias with a **301** to
    the tool's canonical path.

None of those is a 404. The filter, built on the narrower list, did not expose broken links: it
**removed 24 working ones** from the menu and 4 from the footer of every PHP page, and this suite
pinned each removal as correct.

So the guard moved out of the browser and into the gate. A 265-entry list is 9 KB on every page —
44% of the homepage's compressed transfer size — and what it guarded was a redirect, on a site whose
own footer links already resolve. The invariant it was standing in for ("every tool path this theme
can advertise is answered by this shell") is now *measured*: `scripts/site/generate.mjs` derives the
projection from both catalogues, `tests/website/check-tools-resolution.php` resolves all of it through
the real front controller and reports both directions, and the cases below pin the derivation, the
resolver check and the decision to keep it out of the browser.
"""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESOURCES = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources'
SITE_JSON = RESOURCES / 'site.json'
TOOLS_JSON = RESOURCES / 'tools.json'
REGISTRY = ROOT / 'shared' / 'site' / 'registry.json'
SITE_JS = ROOT / 'templates' / 'cloudhost247' / 'js' / 'site.js'
SITE_PHP = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'lib' / 'Site.php'
NAV_TPL = ROOT / 'templates' / 'cloudhost247' / 'includes' / 'site-nav.tpl'
FOOTER_TPL = ROOT / 'templates' / 'cloudhost247' / 'includes' / 'site-footer.tpl'
GENERATOR = ROOT / 'scripts' / 'site' / 'generate.mjs'
RESOLUTION_CHECK = ROOT / 'tests' / 'website' / 'check-tools-resolution.php'
PLATFORM_CATALOG = ROOT / 'cloudhost247-node' / 'src' / 'tools' / 'catalog.ts'

spec = importlib.util.spec_from_file_location(
    'audit_navigation_inventory', ROOT / 'scripts' / 'audit-navigation-inventory.py')
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


def python_served_paths() -> set[str]:
    """The same derivation as `phpServedToolPaths()` in the generator, written independently."""
    return set(inventory.tool_entries())


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
        cls.theme = json.loads(TOOLS_JSON.read_text())

    def test_the_registry_publishes_the_paths_the_shell_serves(self):
        self.assertTrue(self.served, 'site.json carries no toolsServed projection')
        self.assertEqual(sorted(self.served), self.site['toolsServed'],
                         'the projection must be stably ordered so the freshness diff is meaningful')

    def test_the_projection_matches_an_independent_derivation(self):
        # Two implementations of one rule: the generator (JavaScript) and the inventory (Python).
        # If they disagree, one of them is telling a page to link somewhere it cannot go.
        self.assertEqual(python_served_paths(), self.served)

    def test_everything_the_theme_projection_can_answer_is_inside_the_projection(self):
        # The regression this file was rewritten for. `ToolsSite::resolve()` answers the tool's own
        # path and every one of its `legacyPaths`; a projection that leaves any of them out does not
        # hide a broken link, it hides a working one.
        covered = {tool['path'].lstrip('/') for tool in self.theme['tools'] if tool.get('path')}
        for tool in self.theme['tools']:
            covered |= {path.lstrip('/') for path in tool.get('legacyPaths') or []}
        missing = sorted(covered - self.served)
        self.assertEqual([], missing, 'the filter would suppress these served paths')

    def test_the_hub_and_the_discovery_taxonomy_are_inside_the_projection(self):
        registry = json.loads(REGISTRY.read_text())
        self.assertIn('tools', self.served)
        for category in registry['toolsCategories']:
            self.assertIn(f"tools/category/{category['slug']}", self.served)

    def test_a_tool_only_the_theme_projection_knows_is_a_signpost_inside_the_projection(self):
        # `/tools/business-tools` is the documented example: the platform routes it, the registry
        # links it in the Tools menu and the footer, and the native catalogue returns null for it.
        # `tools/index.php` still answers it, with the signpost page, so it belongs here.
        self.assertIn('tools/business-tools', self.served)
        self.assertIn('tools/mrz-generator', self.served)

    def test_the_resolution_check_exists_and_is_wired_into_a_gate(self):
        # The projection is a claim about a PHP resolver. Something has to ask the resolver.
        self.assertTrue(RESOLUTION_CHECK.is_file(), 'no check resolves the projection through PHP')
        probe = RESOLUTION_CHECK.read_text()
        # It has to read the projection the browser is handed, and ask both resolvers the front
        # controller asks — not a third copy of the rule.
        self.assertIn("$site['toolsServed']", probe)
        self.assertIn('Catalog::resolve', probe)
        self.assertIn('ToolsSite::resolve', probe)
        rendered = (ROOT / 'scripts' / 'verify-rendered-site.sh').read_text()
        self.assertIn('check-tools-resolution.php', rendered,
                      'the rendered-site gate must run the resolution check')

    def test_the_theme_keeps_the_projection_in_the_context_but_out_of_the_page(self):
        # `toolsServed` reaches the template context — which is what makes it auditable at render
        # time — and is deliberately not emitted into the HTML. See RuntimeLinkFilterTests for the
        # 9 KB-per-page measurement behind that decision.
        php = SITE_PHP.read_text()
        self.assertIn("'toolsServed' =>", php)
        self.assertNotIn("'toolsServedJson' =>", php)

    def test_the_generator_is_what_writes_the_projection(self):
        generator = GENERATOR.read_text()
        self.assertIn('phpServedToolPaths', generator)
        self.assertIn('toolsServed', generator)


class RuntimeLinkFilterTests(unittest.TestCase):
    """What the shipped script does *not* do, pinned so the decision is visible.

    The template path for this was a served-set filter in the browser. It is gone on purpose: it cost
    9 KB per page to prevent links that the theme's own footer does not publish anyway, and the
    failure it guarded is caught in the gate by resolving the whole surface through PHP. If someone
    reintroduces it, they should read the size numbers above first — hence the assertions.
    """

    @classmethod
    def setUpClass(cls):
        cls.script = SITE_JS.read_text()
        cls.site = json.loads(SITE_JSON.read_text())

    def test_the_browser_is_not_shipped_the_served_set(self):
        for needle in ('servedTools', 'servedHere', 'data-ch-tools-served'):
            self.assertNotIn(needle, self.script,
                             f'{needle} is back in the shipped script; 9 KB per page is the cost')
        for template in (NAV_TPL, FOOTER_TPL):
            self.assertNotIn('data-ch-tools-served', template.read_text(), template.name)
        # The registry still carries the measurement — that is what the render check consumes.
        self.assertIn('toolsServed', self.site)

    def test_the_footer_rewrite_only_appends_a_slug_the_catalogue_answered_for(self):
        # The strip inserts `tools.find(row => row.slug === slug)` and returns when nothing matches,
        # so a slug the live catalogue does not publish appends nothing at all.
        self.assertIn('const tool = tools.find(row => row.slug === slug); if (!tool) return;', self.script)
        self.assertIn('const tools = data.tools.filter(', self.script)
        self.assertIn("/^\\/tools\\/[a-z0-9-]+$/.test(tool.path)", self.script)

    def test_a_link_already_published_by_the_footer_is_not_appended_twice(self):
        self.assertIn('const published = new Set(', self.script)
        self.assertIn('if (published.has(link.href)) return;', self.script)

    def test_the_script_still_reaches_the_menu_and_the_footer(self):
        self.assertIn("document.querySelector('[data-ch-tools-menu]')", self.script)
        self.assertIn("document.querySelector('[data-ch-tools-footer]')", self.script)
        self.assertIn("fetch(base + '/api/tools/navigation'", self.script)


class FooterAndMenuCoverageTests(unittest.TestCase):
    """Every link the runtime enrichment can build resolves at this origin.

    What matters is the *path* the script resolves, not the slug: the platform's `my-ip` points at
    `/tools/what-is-my-ip` while `whois` points at `/tools/domain-whois`, and neither is the path a
    reader would guess from the slug. Comparing slugs reports different answers and is wrong about
    several of them, which is how the four paths this suite once treated as unserved were chosen.
    """

    @classmethod
    def setUpClass(cls):
        cls.site = json.loads(SITE_JSON.read_text())
        cls.served = set(cls.site.get('toolsServed') or [])
        cls.footer_slugs = platform_footer_slugs()
        platform = json.loads(TOOLS_JSON.read_text())
        cls.platform_paths = {tool['slug']: (tool.get('path') or '').lstrip('/')
                              for tool in platform['tools']}
        cls.php_footer_links = {
            link['url'] for column in cls.site['footer'] for link in column['links']
            if column['title'] == 'Tools'
        }

    def test_the_platform_footer_list_is_readable(self):
        self.assertGreaterEqual(len(self.footer_slugs), 5, self.footer_slugs)
        for slug in self.footer_slugs:
            self.assertIn(slug, self.platform_paths, f'{slug} is in the footer list but not the catalogue')

    def test_every_path_the_platform_footer_resolves_to_is_served_here(self):
        # The four paths that used to fail here — ip-lookup, spf-checker, subnet-calculator and
        # json-tools — are the named case: each is answered either by the native catalogue or by the
        # signpost fallback, and the front controller's own resolution is measured in
        # `check-tools-resolution.php` rather than inferred from this list.
        unserved = {self.platform_paths[slug] for slug in self.footer_slugs
                    if self.platform_paths[slug] not in self.served}
        self.assertEqual(set(), unserved,
                         'the footer rewrite would drop these working links')

    def test_the_server_rendered_php_footer_never_names_an_unserved_tool(self):
        for url in self.php_footer_links:
            if url.startswith('tools/') and url.count('/') == 1:
                self.assertIn(url, self.served,
                              f'the footer publishes {url}, which the shell does not serve')

    def test_the_php_footer_does_not_publish_a_platform_signpost_as_a_static_link(self):
        # The signpost page exists, but it is not a working tool — a static footer link would
        # advertise a page that only hands over to the platform application.
        self.assertNotIn('tools/business-tools', self.php_footer_links)

    # Four slugs in the platform's quick-launch strip name a capability this shell implements under
    # a different slug, so the strip's own path resolves to the signpost page rather than to a
    # working tool: `ip-location-lookup`, `spf-record-checker`, `ip-subnet-calculator` and
    # `json-formatter` are the shell's names for the same four. The signpost is honest about that —
    # it says the tool runs in the platform application and links there — and the pages are served
    # `X-Robots-Tag: noindex`, so they are not competing with the working tool for the same query.
    # Whether the shell should alias these four instead is a product decision, not a link fix, so it
    # is recorded rather than taken here: a slug map that turns out to be wrong would send a visitor
    # to a tool that answers a different question.
    SIGNPOSTED_FOOTER_SLUGS = {'ip-lookup', 'spf-checker', 'subnet-calculator', 'json-tools'}

    def test_the_footer_strip_is_a_deliberate_mix_of_working_pages_and_signposts(self):
        entries = inventory.tool_entries()
        signposted = set()
        for slug in self.footer_slugs:
            path = self.platform_paths[slug]
            self.assertIn(path, entries, path)
            if entries[path]['surface'] == 'signpost':
                signposted.add(slug)
        self.assertEqual(self.SIGNPOSTED_FOOTER_SLUGS, signposted,
                         'the footer strip now reaches a different set of pages in this shell; update '
                         'SIGNPOSTED_FOOTER_SLUGS deliberately and re-check the pages are noindex')
        for slug in sorted(signposted):
            row_path = '/' + self.platform_paths[slug]
            signpost_row = next(row for row in json.loads(
                (ROOT / 'docs' / 'website-rebuild' / 'page-inventory.json').read_text())['pages']
                if row['path'] == row_path)
            self.assertEqual('noindex signpost', signpost_row['seo_status'], row_path)


if __name__ == '__main__':
    unittest.main()
