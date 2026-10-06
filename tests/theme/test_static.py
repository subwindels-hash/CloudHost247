from pathlib import Path
import re, unittest
ROOT = Path(__file__).resolve().parents[2]
THEME = ROOT / 'modules/addons/cloudhost247_theme'
ADDON = THEME / 'cloudhost247_theme.php'


class ThemeStaticTests(unittest.TestCase):
    def sources(self):
        return list(THEME.rglob('*.php'))

    def test_every_entry_point_loads_the_extracted_classes(self):
        repo = (THEME / 'lib/ThemeRepository.php').read_text()
        for marker in ('ProductComponents', 'PreviewRenderer'):
            self.assertIn(marker, repo)
        for path in (ADDON, THEME / 'hooks.php', THEME / 'landing-bootstrap.php'):
            text = path.read_text()
            self.assertIn('lib/Content/ProductComponents.php', text, str(path))
            self.assertIn('lib/View/PreviewRenderer.php', text, str(path))

    def test_admin_exposes_the_new_panels_and_operations(self):
        view = ADDON.read_text()
        for marker in ('value="visual_preview"', 'AdminPanels::order', 'AdminPanels::visual', 'name="show_products"', 'name="product_limit"', 'name="widgets"', 'name="layout"', 'name="pages"', 'href="#order"'):
            self.assertIn(marker, view)
        self.assertIn("'block'", view)
        panels = (THEME / 'lib/View/AdminPanels.php').read_text()
        self.assertIn('name="ids[]"', panels)
        self.assertIn('draggable="true"', panels)
        self.assertIn('ch247-order-list', panels)

    def test_capability_and_csrf_guards_cover_the_new_operations(self):
        controller = (THEME / 'lib/AdminController.php').read_text()
        self.assertIn('requireAdmin()', controller)
        self.assertIn('requirePostToken()', controller)
        self.assertIn('requireCapability(', controller)
        self.assertRegex(controller, r"\$capability = in_array\(\$operation,array\([^)]*'reorder'[^)]*'visual_preview'")
        # The two read-only previews and the visual preview are not audited; the
        # reorder write is, and every write stays a POST operation.
        self.assertIn("array('preview','localized_preview','visual_preview')", controller)
        self.assertNotIn("'reorder','preview'", controller)
        self.assertIn("content.'.$operation", controller)

    def test_ordering_is_validated_as_a_permutation(self):
        repo = (THEME / 'lib/ThemeRepository.php').read_text()
        self.assertIn('function reorder(array $input)', repo)
        self.assertIn('every item of that type exactly once', repo)
        self.assertIn('nothing was changed', repo)
        self.assertIn('PREG_SPLIT_NO_EMPTY', repo)
        # Ordering writes one column, in a loop over validated ids only.
        self.assertIn(r"update(array('sort_order' => $index", repo)

    def test_no_second_product_query_in_the_theme(self):
        # The theme renders products through the page builder's reader; it must
        # not grow a second catalogue query of its own.
        for path in self.sources():
            self.assertNotIn("table('tblproducts')", path.read_text(), str(path))
            self.assertNotIn("table('tblpricing')", path.read_text(), str(path))
        bridge = (THEME / 'lib/Content/ProductComponents.php').read_text()
        self.assertIn('CloudHost247\\Builder\\Catalog\\WhmcsDataSource', bridge)
        self.assertIn('not installed', bridge)
        self.assertIn('available', bridge)

    def test_preview_escapes_and_persists_nothing(self):
        renderer = (THEME / 'lib/View/PreviewRenderer.php').read_text()
        self.assertIn('htmlspecialchars', renderer)
        self.assertNotIn('nofilter', renderer)
        body = renderer[renderer.index('public static function render'):renderer.index('public static function css')]
        self.assertNotIn('Capsule::table', body)
        self.assertNotIn('insert', body.lower())
        self.assertNotIn('update(', body.lower())

    def test_no_new_tables_or_destructive_migrations(self):
        # This unit adds behaviour, not schema: the migration ladder is unchanged
        # and no new code creates, drops or renames a table.
        versions = sorted(p.name for p in (THEME / 'migrations').glob('V*.php'))
        self.assertEqual(['V100.php', 'V110.php', 'V120.php'], versions)
        for path in self.sources():
            text = path.read_text()
            self.assertNotIn('dropColumn', text, str(path))
            self.assertNotIn('dropTable', text, str(path))
        for name in ('lib/Content/ProductComponents.php', 'lib/View/PreviewRenderer.php', 'lib/View/AdminPanels.php', 'lib/ThemeRepository.php', 'lib/AdminController.php'):
            text = (THEME / name).read_text()
            self.assertNotIn('schema()->create', text, name)
            self.assertNotIn('schema()->table', text, name)

    def test_no_dynamic_execution_in_the_new_code(self):
        for name in ('lib/Content/ProductComponents.php', 'lib/View/PreviewRenderer.php', 'lib/View/AdminPanels.php', 'lib/ThemeRepository.php', 'lib/AdminController.php'):
            text = (THEME / name).read_text()
            for marker in ('eval(', 'base64_decode', 'shell_exec', 'exec(', 'system(', 'preg_replace(\'/.*/e'):
                self.assertNotIn(marker, text, name + ' ' + marker)

    def test_recorded_gaps_are_closed_in_the_docs(self):
        parity = (ROOT / 'docs/independent-rebuild/AUDIT-AND-PARITY-MATRIX.md').read_text()
        legacy = (ROOT / 'docs/independent-rebuild/PHASE-2-LEGACY-PARITY.md').read_text()
        unfinished = (ROOT / 'docs/UNFINISHED-MODULES.md').read_text()
        for text in (parity, legacy, unfinished):
            self.assertIn('drag', text.lower())
        self.assertIn('product-query', parity)
        self.assertIn('visual preview', parity)


class PublicRouteTests(unittest.TestCase):
    """The root pages must not depend on the encoded vendor theme helper."""

    CONVERTED = {
        'dedicated-server.php': 'dedicated-server',
        'developer-friendly.php': 'developer-friendly',
        'domain.php': 'domain',
        'enterprise-servers.php': 'enterprise-servers',
        'game-servers.php': 'game-servers',
        'offers.php': 'offers',
        'vps-publiccloud.php': 'vps-publiccloud',
        'cloudhost247-sample.php': 'cloudhost247-sample',
        'future-element.php': 'future-element',
        'comingsoon.php': 'coming-soon',
        'all-element-cloudhost247.php': 'all-elements',
        'legal-notice.php': 'legal-notice',
        'help-center.php': 'help-center',
        'blog.php': 'blog',
        'cpanel-hosting.php': 'cpanel-hosting',
        'plesk-hosting.php': 'plesk-hosting',
        'vps-hosting.php': 'vps-hosting',
        'vps-privatecloud.php': 'vps-privatecloud',
        'web-hosting.php': 'web-hosting',
        'website-design.php': 'website-design',
        'windows-hosting.php': 'windows-hosting',
        'wordpress-hosting.php': 'wordpress-hosting',
        'ssl-certificate.php': 'ssl-certificate',
        'tables.php': 'tables',
        'cloudhost247-vps-sample.php': 'vps-sample',
        'data-protection-standards.php': 'data-protection-standards',
        'terms-of-service.php': 'terms-of-service',
    }

    def test_converted_routes_render_published_content(self):
        for page, slug in self.CONVERTED.items():
            text = (ROOT / page).read_text()
            self.assertIn("define('CLIENTAREA', true);", text, page)
            self.assertIn("require __DIR__ . '/init.php';", text, page)
            self.assertIn('PublicPage.php', text, page)
            self.assertIn("PublicPage::route(", text, page)
            self.assertIn("'%s'" % slug, text, page)
            # The vendor shell is gone, and so is the vendor content table.
            self.assertNotIn('cloudhost247_legacy', text, page)
            self.assertNotIn('mod_cloudhost247_theme_pages', text, page)

    def test_not_found_route_always_answers_404(self):
        text = (ROOT / 'notfound.php').read_text()
        self.assertIn('PublicPage::notFound(', text)
        self.assertNotIn('cloudhost247_legacy', text)
        controller = (THEME / 'lib/PublicPage.php').read_text()
        self.assertIn('http_response_code((int) $status)', controller)
        self.assertIn('const TEMPLATE = ', controller)

    def test_misspelled_duplicate_redirects_permanently(self):
        text = (ROOT / 'dedeicated-server.php').read_text()
        self.assertIn('301', text)
        self.assertIn('dedicated-server.php', text)
        self.assertNotIn('setTemplate', text)
        self.assertNotIn('init.php', text)

    def test_no_root_page_renders_the_vendor_shell(self):
        offenders = []
        for path in ROOT.glob('*.php'):
            text = path.read_text()
            if "setTemplate('cloudhost247_legacy')" in text or 'setTemplate("cloudhost247_legacy")' in text:
                offenders.append(path.name)
            if path.name == 'cloudhost247-page.php':
                continue
            self.assertNotIn('mod_cloudhost247_theme_pages', text, path.name)
        self.assertEqual(offenders, [])

    def test_page_template_renders_the_product_component_safely(self):
        tpl = (ROOT / 'templates/cloudhost247/cloudhost247-page.tpl').read_text()
        self.assertIn('includes/product-plans.tpl', tpl)
        tpl += (ROOT / 'templates/cloudhost247/includes/product-plans.tpl').read_text()
        self.assertIn('cloudhost247Page.product_component', tpl)
        self.assertIn('product_component.products', tpl)
        # Every dynamic value in the product markup goes through an escape.
        for marker in ('$product.name|escape', '$product.description|escape', '$product.price.formatted|escape', '$product.order_url|escape', '$cloudhost247Page.product_component.reason|escape'):
            self.assertIn(marker, tpl)
        self.assertNotIn('$product.order_url}', tpl)

    def test_front_controller_is_fail_safe_and_escaped(self):
        controller = (THEME / 'lib/PublicPage.php').read_text()
        self.assertIn('catch (\Throwable', controller)
        self.assertIn('htmlspecialchars', controller)
        self.assertIn('no published content', controller)
        self.assertNotIn('mod_cloudhost247_theme_pages', controller)
        self.assertIn('withProducts', controller)
        self.assertIn('ProductComponents::resolve', controller)


if __name__ == '__main__':
    unittest.main()
