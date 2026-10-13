from pathlib import Path
import re, unittest
ROOT = Path(__file__).resolve().parents[2]
MODULES = ['cloudhost247_core', 'cloudhost247_theme', 'cloudhost247_currency', 'cloudhost247_integrations', 'cloudhost247_modules', 'cloudhost247_builder', 'cloudhost247_ovh']

class FoundationStaticTests(unittest.TestCase):
    def test_entrypoints_and_migrations_exist(self):
        for module in MODULES:
            self.assertTrue((ROOT/'modules/addons'/module/f'{module}.php').is_file())
        for module in MODULES[1:]:
            self.assertTrue((ROOT/'modules/addons'/module/'migrations/V100.php').is_file())

    def test_no_vendor_license_configuration_in_replacements(self):
        terms = re.compile(r'licenseNumtoactivate|CheckLicense|whmcsglobalservices|xtreme_currency_rates', re.I)
        for module in MODULES:
            for path in (ROOT/'modules/addons'/module).rglob('*.php'):
                self.assertIsNone(terms.search(path.read_text()), str(path))

    def test_deactivation_is_non_destructive(self):
        for module in MODULES:
            entry = (ROOT/'modules/addons'/module/f'{module}.php').read_text()
            self.assertNotIn('dropIfExists', entry)
            if module != 'cloudhost247_core': self.assertIn('Data retained', entry)

    def test_only_namespaced_tables_created(self):
        for module in MODULES:
            for path in (ROOT/'modules/addons'/module).rglob('*.php'):
                for table in re.findall(r"schema\(\)->create\('([^']+)'", path.read_text()):
                    self.assertTrue(table.startswith('mod_cloudhost247_'), (path, table))

    def test_theme_is_supported_child_and_cart(self):
        theme = (ROOT/'templates/cloudhost247/theme.yaml').read_text()
        cart = (ROOT/'templates/orderforms/cloudhost247/theme.yaml').read_text()
        self.assertIn('parent: twenty-one', theme)
        self.assertIn('parent: standard_cart', cart)

    def test_templates_escape_dynamic_plain_text(self):
        homepage = (ROOT/'templates/cloudhost247/homepage.tpl').read_text()
        page = (ROOT/'templates/cloudhost247/cloudhost247-page.tpl').read_text()
        self.assertIn('hero_title|escape', homepage)
        self.assertIn('title|escape', page)
        self.assertNotIn('$cloudhost247Page.title nofilter', page)

    def test_custom_route_uses_whmcs_client_area(self):
        route = (ROOT/'cloudhost247-page.php').read_text()
        self.assertIn("require __DIR__ . '/init.php'", route)
        self.assertIn('new ClientArea()', route)
        self.assertNotIn('session_start', route)

    def test_sitemap_uses_published_cms_pages(self):
        route=(ROOT/'cloudhost247-sitemap.php').read_text()
        discovery=(ROOT/'modules/addons/cloudhost247_theme/lib/PublicDiscovery.php').read_text()
        repo=(ROOT/'modules/addons/cloudhost247_theme/lib/ThemeRepository.php').read_text()
        publication=repo.split('public function publicPageIndex',1)[1].split('public function findPublishedPage',1)[0]
        # Publication filtering moved into the shared read model; keep checking the
        # route-to-query chain, not an obsolete direct repository call in the route.
        self.assertIn('PublicDiscovery::pages($repo)',route)
        self.assertIn('PublicDiscovery::sitemapPaths($pages)',route)
        self.assertIn('$repository->publicPageIndex($locale)',discovery)
        self.assertIn("whereIn('content_type', array('page', 'landing'))",publication)
        self.assertIn('if ($row->published && $index[$row->slug] === null)',publication)
        self.assertIn('ENT_XML1',route)

    def test_publication_and_localization_rules(self):
        repo=(ROOT/'modules/addons/cloudhost247_theme/lib/ThemeRepository.php').read_text()
        self.assertIn("where('published', 1)",repo)
        self.assertIn('mod_cloudhost247_theme_translations',repo)
        self.assertIn('base-content fallback', (ROOT/'modules/addons/cloudhost247_theme/lib/AdminController.php').read_text())

    def test_preview_sanitizes_without_persisting(self):
        repo=(ROOT/'modules/addons/cloudhost247_theme/lib/ThemeRepository.php').read_text()
        preview=repo[repo.index('public function preview(array'):repo.index('public function previewTranslation')]
        self.assertIn('sanitizeHtml',preview);self.assertNotIn('Capsule::table',preview)

    def test_open_graph_is_escaped(self):
        hooks=(ROOT/'modules/addons/cloudhost247_theme/hooks.php').read_text()
        self.assertIn('property="og:title"',hooks);self.assertIn("htmlspecialchars($vars['cloudhost247Page']",hooks)

# PHP 8 reports a tentative return type on an internal-interface implementation as a deprecation
# at class-declaration time — before any suite's own error handler exists — so the notices print
# and the suite still passes. Twenty of them from three test fakes sat in the release gate's output
# for that reason. These are the methods PHP warns about, with the type it wants.
INTERFACE_METHOD_TYPES = {
    'offsetExists': 'bool', 'offsetSet': 'void', 'offsetUnset': 'void',
    'count': 'int', 'getIterator': 'Traversable',
    'next': 'void', 'rewind': 'void', 'valid': 'bool',
}
IMPLEMENTS_INTERNAL = re.compile(r'implements[^{;]*\b(?:ArrayAccess|Countable|IteratorAggregate|Iterator)\b')

CLASS_DECLARATION = re.compile(r'\b(?:final\s+|abstract\s+)*class\s+(\w+)([^{;]*)\{')
INTERNAL_INTERFACES = re.compile(r'\b(?:ArrayAccess|Countable|IteratorAggregate|Iterator)\b')

def class_bodies(source):
    """(class name, declaration clause, body) for every class in a file, brace-matched.

    The scan has to be per class: a fake file declares a `Countable` collection *and* a query
    builder whose `count()` is an illuminate-style API method, not an interface implementation.
    Judging the whole file flags the second one, which is not a deprecation PHP emits.
    """
    bodies = []
    for match in CLASS_DECLARATION.finditer(source):
        depth, index = 1, match.end()
        while index < len(source) and depth:
            if source[index] == '{':
                depth += 1
            elif source[index] == '}':
                depth -= 1
            index += 1
        bodies.append((match.group(1), match.group(2), source[match.end():index - 1]))
    return bodies

def untyped_interface_methods(source):
    """`Class::method` for every interface method declared without the return type PHP 8 wants.

    `offsetGet` is deliberately absent from INTERFACE_METHOD_TYPES: the type PHP wants is `mixed`,
    which arrived in 8.0, and this repository still runs a PHP 7.4 leg where `mixed` is a parse
    error. The attribute PHP recommends for exactly that case is accepted instead — 7.4 parses
    `#[...]` as a comment, so one declaration serves both legs.
    """
    findings = []
    for class_name, clause, body in class_bodies(source):
        if not INTERNAL_INTERFACES.search(clause):
            continue
        for match in re.finditer(r'function\s+(\w+)\s*\(', body):
            method = match.group(1)
            if method not in INTERFACE_METHOD_TYPES:
                continue
            depth, index = 0, match.end() - 1
            while index < len(body):
                if body[index] == '(':
                    depth += 1
                elif body[index] == ')':
                    depth -= 1
                    if depth == 0:
                        break
                index += 1
            opening = body.find('{', index)
            signature = body[index + 1:opening if opening != -1 else index + 120]
            if ':' in signature:
                continue
            if 'ReturnTypeWillChange' in body[max(0, match.start() - 160):match.start()]:
                continue
            findings.append(f'{class_name}::{method}')
    return sorted(set(findings))

def first_party_php_files():
    for directory in ('tests', 'modules/addons', 'modules/servers', 'tools', 'includes'):
        for path in (ROOT / directory).rglob('*.php'):
            if 'vendor' not in path.parts:
                yield path
    for path in sorted(ROOT.glob('*.php')):
        yield path

class TentativeReturnTypeTests(unittest.TestCase):
    def test_no_first_party_php_declares_an_untyped_interface_method(self):
        scanned = list(first_party_php_files())
        self.assertGreaterEqual(len(scanned), 500, 'the scan should cover the first-party tree')
        implementing = [path for path in scanned if IMPLEMENTS_INTERNAL.search(path.read_text(errors='replace'))]
        self.assertGreaterEqual(len(implementing), 6, 'the six test fakes implement these interfaces')
        offenders = {str(path.relative_to(ROOT)): untyped_interface_methods(path.read_text(errors='replace'))
                     for path in implementing}
        offenders = {path: names for path, names in offenders.items() if names}
        self.assertEqual(offenders, {}, 'PHP 8 tentative-return-type deprecations: ' + repr(offenders))

    def test_an_untyped_interface_method_is_reported(self):
        source = (ROOT / 'tests/ovh/fakes.php').read_text()
        self.assertEqual(untyped_interface_methods(source), [])
        doctored = source.replace('public function count(): int {', 'public function count() {', 1)
        self.assertNotEqual(doctored, source, 'the fake should still declare the type')
        self.assertEqual(untyped_interface_methods(doctored), ['CH247OvhFakeCollection::count'])
        # A same-named method on a class that implements none of them is not PHP's deprecation.
        self.assertIn('public function count() {', source, 'the query fake keeps an untyped count()')
        # The attribute is the accepted alternative where no 7.4-compatible type exists.
        attributed = source.replace('public function count(): int {',
                                    '#[\\ReturnTypeWillChange]\n        public function count() {', 1)
        self.assertEqual(untyped_interface_methods(attributed), [])

if __name__ == '__main__': unittest.main()
