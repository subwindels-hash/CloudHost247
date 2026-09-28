from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'modules/addons/cloudhost247_builder'
DOCS = ROOT / 'docs/independent-rebuild'

PHP_SOURCES = sorted(p for p in MODULE.rglob('*.php') if p.is_file())
ASSET_JS = sorted(p for p in (MODULE / 'assets/js').rglob('*.js') if p.is_file())


def strip_comments(text):
    """PHP source with block and line comments removed, so policy assertions
    match real code rather than the prose that documents it."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$', '', text)


class WebsiteBuilderStaticTests(unittest.TestCase):
    def source(self, relative):
        return (MODULE / relative).read_text()

    def code(self, relative):
        return strip_comments(self.source(relative))

    # -------------------------------------------------------------- structure
    def test_module_layout(self):
        for path in (
            'cloudhost247_builder.php', 'bootstrap.php', 'hooks.php', 'README.md', 'migrations/V100.php',
            'lib/Support/BuilderException.php', 'lib/Support/Slug.php', 'lib/Support/Ids.php',
            'lib/Support/UrlPolicy.php', 'lib/Support/HtmlSanitizer.php', 'lib/Support/CssSanitizer.php',
            'lib/Support/Paths.php',
            'lib/Schema/Document.php', 'lib/Schema/Node.php', 'lib/Schema/SchemaValidator.php',
            'lib/Schema/StyleSchema.php', 'lib/Schema/DocumentMigrator.php',
            'lib/Widgets/WidgetCatalog.php', 'lib/Widgets/WidgetDefinition.php',
            'lib/Render/Renderer.php', 'lib/Render/WidgetRenderer.php', 'lib/Render/StyleCompiler.php',
            'lib/Render/RenderContext.php', 'lib/Render/Icons.php',
            'lib/Contracts/LiveDataSource.php', 'lib/Catalog/WhmcsDataSource.php', 'lib/Catalog/CartLinks.php',
            'lib/Repositories/PageRepository.php', 'lib/Repositories/LibraryRepository.php',
            'lib/Repositories/MediaRepository.php', 'lib/Repositories/FormRepository.php',
            'lib/Repositories/EventRepository.php',
            'lib/Security/CapabilityPolicy.php',
            'lib/Services/PageService.php', 'lib/Services/TemplateService.php', 'lib/Services/ThemeService.php',
            'lib/Services/MediaService.php', 'lib/Services/FormService.php', 'lib/Services/MenuService.php',
            'lib/Services/Settings.php', 'lib/Services/DisplayConditions.php', 'lib/Services/Starters.php',
            'lib/Site/PageResolver.php',
            'lib/Admin/AdminController.php', 'lib/Admin/AdminView.php', 'lib/Admin/EditorContext.php',
            'assets/js/editor.js', 'assets/js/runtime.js',
            'assets/css/editor.css', 'assets/css/runtime.css', 'assets/css/admin.css',
        ):
            self.assertTrue((MODULE / path).is_file(), path)

    def test_public_and_cron_entry_points_exist(self):
        self.assertTrue((ROOT / 'builder-page.php').is_file())
        self.assertTrue((ROOT / 'crons/cloudhost247_builder.php').is_file())
        self.assertTrue((ROOT / 'templates/cloudhost247/cloudhost247-builder-page.tpl').is_file())

    def test_every_source_is_namespaced_and_guarded(self):
        for path in PHP_SOURCES:
            text = path.read_text()
            if path.parent == MODULE:
                self.assertIn("defined('WHMCS')", text, str(path))
            else:
                self.assertRegex(text, r'namespace CloudHost247\\Builder', str(path))

    def test_deactivation_keeps_content(self):
        entry = self.source('cloudhost247_builder.php')
        self.assertIn('Data retained', entry)
        self.assertNotIn('dropIfExists', entry)
        self.assertNotIn('->drop(', entry)

    # ------------------------------------------------------- code execution
    def test_no_dangerous_callables_anywhere(self):
        banned = re.compile(
            r'(?<![\w:>$])(eval|exec|shell_exec|system|passthru|proc_open|popen|pcntl_exec|assert)\s*\(')
        for path in PHP_SOURCES:
            self.assertIsNone(banned.search(path.read_text()), str(path))

    def test_no_unserialize_of_stored_content(self):
        for path in PHP_SOURCES:
            self.assertNotRegex(path.read_text(), r'(?<![\w:>$])unserialize\s*\(', str(path))

    def test_no_dynamic_includes_outside_the_autoloader(self):
        dynamic = re.compile(r'\b(include|include_once|require|require_once)\s*\(?\s*\$')
        for path in PHP_SOURCES:
            if path.name == 'bootstrap.php':
                continue
            self.assertIsNone(dynamic.search(path.read_text()), str(path))
        bootstrap = self.code('bootstrap.php')
        self.assertIn("__DIR__ . '/lib/'", bootstrap)
        self.assertIn("CloudHost247\\\\Builder\\\\", bootstrap)

    def test_template_import_only_reads_json(self):
        service = self.code('lib/Services/TemplateService.php')
        self.assertIn('json_decode', service)
        for banned in ('ZipArchive', 'file_put_contents', 'move_uploaded_file', 'include', 'require'):
            self.assertNotIn(banned, service, banned)

    # ------------------------------------------------------------- rendering
    def test_renderer_escapes_everything_it_emits(self):
        renderer = self.code('lib/Render/Renderer.php')
        widgets = self.code('lib/Render/WidgetRenderer.php')
        self.assertIn('htmlspecialchars', renderer)
        self.assertIn('ENT_QUOTES', renderer)
        self.assertIn('htmlspecialchars', widgets)
        # The only unescaped output is rich text, which HtmlSanitizer produced.
        self.assertIn('sanitizer->clean', widgets)

    def test_the_only_script_tag_is_escaped_structured_data(self):
        """One widget emits a <script> element: FAQ structured data. Its payload
        is json_encode output with the HTML hex flags set, so no administrator
        text can close the element or introduce executable code."""
        widgets = self.code('lib/Render/WidgetRenderer.php')
        emitted = re.findall(r"'<script[^']*'", widgets)
        self.assertEqual(emitted, ['\'<script type="application/ld+json">\''])
        for flag in ('JSON_HEX_TAG', 'JSON_HEX_AMP', 'JSON_HEX_APOS', 'JSON_HEX_QUOT'):
            self.assertIn(flag, widgets, flag)
        # Structured data is skipped in the editor, where the canvas is a live DOM.
        self.assertIn('!$context->isEditor()', widgets)

    def test_catalogue_has_no_raw_html_or_script_widget(self):
        catalog = self.code('lib/Widgets/WidgetCatalog.php')
        for banned in ("'html' =>", "'raw_html' =>", "'script' =>", "'shortcode' =>", "'php' =>"):
            self.assertNotIn(banned, catalog, banned)

    def test_html_sanitiser_allowlist_excludes_scriptable_elements(self):
        sanitizer = self.code('lib/Support/HtmlSanitizer.php')
        for tag in ('script', 'iframe', 'object', 'embed', 'form', 'svg', 'math'):
            self.assertIn("'" + tag + "'", sanitizer, tag)
        allowed = sanitizer.split('const ALLOWED = array(')[1].split(');')[0]
        for tag in ('script', 'iframe', 'object', 'embed', 'form', 'svg', 'style', 'link'):
            self.assertNotIn("'" + tag + "' =>", allowed, tag)
        self.assertNotIn("'style'", allowed.split("'img' => array(")[1].split(')')[0])

    def test_css_sanitiser_blocks_the_known_vectors(self):
        css = self.code('lib/Support/CssSanitizer.php')
        for pattern in ('expression', 'behaviou?r', 'javascript', '@import', '-moz-binding'):
            self.assertIn(pattern, css, pattern)

    def test_url_policy_scheme_allowlist(self):
        policy = self.code('lib/Support/UrlPolicy.php')
        self.assertIn("LINK_SCHEMES = array('https', 'http', 'mailto', 'tel')", policy)
        self.assertIn("MEDIA_SCHEMES = array('https', 'http')", policy)

    # ------------------------------------------------------------- live data
    def test_live_data_contract_allows_unknown(self):
        contract = self.source('lib/Contracts/LiveDataSource.php')
        self.assertIn('returns null when the underlying source cannot be read', contract)
        self.assertIn('function available()', contract)
        self.assertIn('function unavailableReason()', contract)

    def test_no_hard_coded_prices_or_demo_data(self):
        """A money-shaped literal must never appear in rendering or catalogue code."""
        money = re.compile(r'[$£€]\s?\d')
        for relative in (
            'lib/Render/WidgetRenderer.php', 'lib/Catalog/WhmcsDataSource.php',
            'lib/Widgets/WidgetCatalog.php', 'lib/Services/Starters.php',
        ):
            self.assertIsNone(money.search(self.code(relative)), relative)

    def test_commerce_links_point_at_whmcs(self):
        links = self.code('lib/Catalog/CartLinks.php')
        for target in ('cart.php?a=add', 'cart.php?a=view', 'cart.php?a=checkout',
                       'domainchecker.php', 'clientarea.php', 'register.php'):
            self.assertIn(target, links, target)

    def test_domain_pricing_uses_the_whmcs_year_columns(self):
        source = self.code('lib/Catalog/WhmcsDataSource.php')
        self.assertIn("DOMAIN_YEAR_COLUMN = 'msetupfee'", source)
        self.assertIn("'domainregister'", source)
        # Client-group override rows must not be mistaken for base pricing.
        self.assertIn("where('tsetupfee', 0)", source)

    def test_products_and_prices_come_from_whmcs_tables(self):
        source = self.code('lib/Catalog/WhmcsDataSource.php')
        for table in ('tblproducts', 'tblproductgroups', 'tblpricing', 'tbldomainpricing', 'tblcurrencies'):
            self.assertIn(table, source, table)
        self.assertIn('if ($amount < 0) { return null; }', source)

    # ------------------------------------------------------------- publishing
    def test_draft_and_published_content_are_separate_columns(self):
        migration = self.code('migrations/V100.php')
        self.assertIn("longText('document_json')", migration)
        self.assertIn("longText('published_json')", migration)
        repository = self.code('lib/Repositories/PageRepository.php')
        self.assertIn('public function saveDraft', repository)
        self.assertIn("'document_json' => $json", repository)
        save_draft = repository.split('public function saveDraft')[1].split('public function publish')[0]
        self.assertNotIn('published_json', save_draft)

    def test_unpublishing_removes_the_live_copy(self):
        service = self.code('lib/Services/PageService.php')
        unpublish = service.split('public function unpublish')[1].split('public function archive')[0]
        self.assertIn("'published_json' => null", unpublish)
        self.assertIn("'published_checksum' => ''", unpublish)

    def test_resolver_only_serves_published_content(self):
        resolver = self.code('lib/Site/PageResolver.php')
        self.assertIn('$this->pages->published($page)', resolver)
        self.assertIn('verifyPreviewToken', resolver)
        self.assertIn("'noindex,nofollow'", resolver)
        self.assertIn("$page['status'] === 'scheduled'", resolver)

    def test_preview_tokens_are_stored_hashed(self):
        repository = self.code('lib/Repositories/PageRepository.php')
        self.assertIn("'token_hash' => Ids::fingerprint($token)", repository)
        self.assertNotIn("'token' =>", repository)

    def test_scheduled_pages_do_not_depend_on_the_cron(self):
        cron = (ROOT / 'crons/cloudhost247_builder.php').read_text()
        self.assertIn('PHP_SAPI', cron)
        self.assertIn('does not depend on this cron', cron)

    # ----------------------------------------------------------- permissions
    def test_every_admin_action_declares_a_capability(self):
        controller = self.code('lib/Admin/AdminController.php')
        actions = re.findall(r"case '([a-z]+\.[a-z_]+)':", controller)
        declared = set(re.findall(r"'([a-z]+\.[a-z_]+)' => 'builder\.[a-z]+'", controller))
        for action in actions:
            self.assertIn(action, declared, action)

    def test_controller_enforces_authentication_and_csrf(self):
        controller = self.code('lib/Admin/AdminController.php')
        self.assertIn('AdminGuard::requireAdmin()', controller)
        self.assertIn('AdminGuard::requirePostToken()', controller)
        self.assertIn('AdminGuard::requireCapability(self::MODULE', controller)

    def test_publishing_and_css_are_privileged_by_default(self):
        policy = self.code('lib/Security/CapabilityPolicy.php')
        self.assertIn("PRIVILEGED = array('builder.publish', 'builder.css', 'builder.settings', 'builder.delete')", policy)
        self.assertIn('SUPER_ADMIN_ROLE_NAMES', policy)
        self.assertIn('Existing rows are never overwritten', self.source('lib/Security/CapabilityPolicy.php'))

    def test_asset_route_is_allowlisted(self):
        controller = self.code('lib/Admin/AdminController.php')
        assets = controller.split('const ASSETS = array(')[1].split(');')[0]
        for name in ('editor.js', 'editor.css', 'admin.css', 'runtime.css', 'runtime.js'):
            self.assertIn(name, assets, name)
        self.assertIn('isset(self::ASSETS[$asset])', controller)
        self.assertIn('nosniff', controller)

    # ----------------------------------------------------------------- media
    def test_media_uploads_are_validated_three_ways(self):
        service = self.code('lib/Services/MediaService.php')
        self.assertIn('const ALLOWED', service)
        self.assertIn('const MAGIC', service)
        self.assertIn('finfo_open', service)
        self.assertIn('getimagesize', service)
        self.assertIn('is_uploaded_file', service)
        self.assertIn('chmod($destination, 0644)', service)

    def test_media_refuses_scriptable_formats(self):
        service = self.source('lib/Services/MediaService.php')
        self.assertIn("'svg' =>", service)
        self.assertIn("'php' =>", service)
        allowed = strip_comments(service).split('const ALLOWED = array(')[1].split(');')[0]
        for banned in ('svg', 'html', 'php', 'js', 'phtml'):
            self.assertNotIn("'" + banned + "'", allowed, banned)

    def test_media_directory_is_hardened(self):
        paths = self.code('lib/Support/Paths.php')
        self.assertIn('php_flag engine off', paths)
        self.assertIn('Options -Indexes -ExecCGI', paths)
        self.assertIn('containedPath', paths)

    def test_stored_file_names_are_server_generated(self):
        service = self.code('lib/Services/MediaService.php')
        builder = service.split('private function buildFileName')[1].split('private function safeName')[0]
        self.assertIn("preg_replace('/[^A-Za-z0-9]+/', '-'", builder)
        self.assertIn('substr($checksum, 0, 10)', builder)

    # ----------------------------------------------------------------- forms
    def test_public_forms_are_protected(self):
        service = self.code('lib/Services/FormService.php')
        for marker in ('ch247_hp', 'MIN_FILL_SECONDS', 'recentSubmissionCount', 'hash_equals', 'hash_hmac'):
            self.assertIn(marker, service, marker)

    def test_forms_never_store_mail_credentials(self):
        service = self.code('lib/Services/FormService.php')
        for banned in ('smtp_password', 'smtp_user', 'SMTPAuth', 'mail(', 'PHPMailer'):
            self.assertNotIn(banned, service, banned)
        self.assertIn('localAPI', service)

    def test_submissions_store_hashed_addresses_only(self):
        migration = self.code('migrations/V100.php')
        self.assertIn("string('ip_hash', 64)", migration)
        self.assertNotIn("string('ip_address'", migration)
        events = self.code('lib/Repositories/EventRepository.php')
        self.assertIn('SECRET_HINTS', events)
        self.assertIn("hash('sha256', $salt", events)

    # ------------------------------------------------------------- migration
    def test_migration_is_additive_and_namespaced(self):
        migration = self.code('migrations/V100.php')
        self.assertEqual(migration.count('hasTable'), migration.count('$schema->create('))
        self.assertIn("return '1.0.0'", migration)
        for banned in ('->drop(', '->dropIfExists(', '->rename(', 'ALTER TABLE', 'DROP TABLE'):
            self.assertNotIn(banned, migration, banned)
        for table in re.findall(r"\$schema->create\('([a-z0-9_]+)'", migration):
            self.assertTrue(table.startswith('mod_cloudhost247_builder_'), table)

    def test_no_core_whmcs_table_is_written(self):
        for path in PHP_SOURCES:
            code = strip_comments(path.read_text())
            for write in re.findall(r"Capsule::table\('(tbl[a-z]+)'\)([^;]*)", code):
                self.assertNotRegex(write[1], r'->(insert|update|delete|insertGetId|updateOrInsert)\b', str(path))

    # ------------------------------------------------------------ javascript
    def test_editor_javascript_has_no_inline_handlers_or_eval(self):
        for path in ASSET_JS:
            text = path.read_text()
            self.assertNotRegex(text, r'\beval\s*\(', str(path))
            self.assertNotRegex(text, r'\bnew Function\s*\(', str(path))
            self.assertNotRegex(text, r'\.innerHTML\s*=\s*[a-zA-Z_$][\w$.]*\s*\+', str(path))
            self.assertNotIn('document.write(', text.replace("doc.write('<!doctype html>", ''), str(path))

    def test_runtime_javascript_is_progressive_enhancement_only(self):
        runtime = (MODULE / 'assets/js/runtime.js').read_text()
        self.assertIn('Progressive enhancement only', runtime)
        self.assertNotIn('fetch(', runtime)
        self.assertNotIn('XMLHttpRequest', runtime)

    def test_editor_posts_the_csrf_token_with_every_write(self):
        editor = (MODULE / 'assets/js/editor.js').read_text()
        self.assertIn("body.append('token', config.token)", editor)
        self.assertIn("form.append('token', config.token)", editor)

    # ------------------------------------------------- editor interactions
    #
    # The brief was explicit that this must not be "a collection of buttons
    # that do nothing". These assertions pin the interaction contract so a
    # refactor cannot quietly reduce the editor to a mockup. They deliberately
    # check wiring rather than appearance: a control that loses its handler,
    # or a drag path that stops mutating the document, fails here.

    def test_editor_wires_drag_and_drop(self):
        editor = self.source('assets/js/editor.js')
        # Canvas nodes are draggable and carry a move payload.
        self.assertIn("node.setAttribute('draggable', 'true')", editor)
        for event_name in ("'dragstart'", "'dragover'", "'drop'"):
            self.assertIn("addEventListener(%s" % event_name, editor)
        self.assertRegex(editor, r"dataTransfer\.setData\('text/plain',\s*JSON\.stringify\(\{\s*move:")
        # Palette tiles are draggable and carry an add payload.
        self.assertIn("tile.setAttribute('draggable', 'true')", editor)
        self.assertRegex(editor, r"effectAllowed\s*=\s*'copy'")
        # Empty containers expose drop zones, including the document root.
        self.assertIn('data-ch247-dropzone', editor)
        self.assertIn("handleDrop(event.dataTransfer.getData('text/plain')", editor)
        self.assertIn("target === 'root' ? null : target)", editor)
        # handleDrop services both gestures and mutates the document.
        self.assertRegex(editor, r'function handleDrop\(')
        self.assertRegex(editor, r'if \(data\.add\)')
        self.assertRegex(editor, r'if \(data\.move\)')
        for call in ('insertNode(', 'removeNode(', 'repaint('):
            self.assertIn(call, editor)

    def test_editor_refuses_impossible_drops(self):
        editor = self.source('assets/js/editor.js')
        # A node may not be dropped into its own subtree.
        self.assertIn('isDescendant(moving.node, targetId)', editor)
        self.assertIn('An element cannot be dropped inside itself.', editor)
        # A placement the schema forbids is rolled back rather than forced.
        self.assertIn('That element cannot go there.', editor)
        self.assertIn('state.history.pop()', editor)
        # Containment is decided by a rule table, not hard-coded per widget.
        self.assertRegex(editor, r'function accepts\(')

    def test_editor_supports_inline_text_editing(self):
        editor = self.source('assets/js/editor.js')
        self.assertIn("field.setAttribute('contenteditable', 'true')", editor)
        self.assertIn('data-ch247-inline', editor)
        # The edit is committed back into the document on blur, against the
        # owning node, rather than left in the DOM.
        self.assertIn("addEventListener('blur'", editor)
        self.assertIn("field.closest('[data-ch247-id]')", editor)

    def test_editor_has_a_real_undo_history(self):
        editor = self.source('assets/js/editor.js')
        for name in ('function pushHistory(', 'function undo(', 'function redo('):
            self.assertIn(name, editor)
        self.assertIn("toolButton('Undo', undo)", editor)
        self.assertIn("toolButton('Redo', redo)", editor)
        # Keyboard shortcuts are wired to the same functions.
        self.assertRegex(editor, r"key === 'z' && !event\.shiftKey.*undo\(\)")
        self.assertRegex(editor, r"key === 's'.*saveDraft\(false\)")

    def test_editor_supports_copy_paste_duplicate_and_delete(self):
        editor = self.source('assets/js/editor.js')
        self.assertIn("smallButton('Duplicate'", editor)
        self.assertIn("smallButton('Copy'", editor)
        self.assertIn("smallButton('Paste into'", editor)
        self.assertIn("smallButton('Delete'", editor)
        self.assertIn('state.clipboard', editor)
        # Pasted and duplicated nodes get fresh ids so the document stays valid.
        self.assertIn('function freshIds(', editor)
        self.assertRegex(editor, r'freshIds\(clone\(state\.clipboard\)\)')
        self.assertRegex(editor, r'freshIds\(clone\(found\.node\)\)')

    def test_no_editor_button_is_inert(self):
        """Every button the editor builds is created through a factory that
        attaches a click handler, and every call site supplies one."""
        editor = self.source('assets/js/editor.js')
        for factory in ('toolButton', 'smallButton'):
            definition = re.search(
                r'function %s\(label, handler[^)]*\)\s*\{(.*?)\n    \}' % factory, editor, re.S)
            self.assertIsNotNone(definition, factory)
            self.assertIn("addEventListener('click', handler)", definition.group(1), factory)

        call_sites = re.findall(r"\b(?:tool|small)Button\(\s*'([^']*)'\s*(.?)", editor)
        self.assertGreaterEqual(len(call_sites), 10)
        for label, following in call_sites:
            # A comma means a handler argument follows the label.
            self.assertEqual(',', following, 'button %r has no handler' % label)

    def test_editor_offers_per_device_styling(self):
        editor = self.source('assets/js/editor.js')
        self.assertIn('function setDevice(', editor)
        self.assertIn("button.setAttribute('data-device', device.key)", editor)
        self.assertIn("addEventListener('click', function () { setDevice(device.key); })", editor)
        # Style reads and writes are scoped to the device being edited, so a
        # tablet or mobile value cannot overwrite the desktop one.
        self.assertIn('node.style[state.device]', editor)
        self.assertRegex(editor, r'delete node\.style\[state\.device\]\[property\]')
        # The inheritance rule is stated to the administrator, not implied.
        self.assertIn('Tablet and mobile inherit desktop until you set them.', editor)

    def test_editor_canvas_is_rendered_by_the_server(self):
        """The canvas must be the real renderer's output, not a lookalike the
        browser draws, otherwise preview/published parity is unverifiable."""
        editor = self.source('assets/js/editor.js')
        self.assertRegex(editor, r"api\('render'")
        self.assertIn('function repaint(', editor)
        self.assertIn('function paintCanvas(', editor)
        # Links and forms inside the canvas are neutralised while editing.
        self.assertIn("querySelectorAll('a, form, button')", editor)

    # ------------------------------------------------------------ front page
    def test_front_controller_checks_module_state_and_session(self):
        controller = (ROOT / 'builder-page.php').read_text()
        self.assertIn('ch247_builder_module_active', controller)
        self.assertIn("http_response_code(404)", controller)
        self.assertIn("isset($_SESSION['uid'])", controller)
        self.assertIn('ClientArea', controller)

    def test_hooks_only_add_output(self):
        hooks = (ROOT / 'modules/addons/cloudhost247_builder/hooks.php').read_text()
        self.assertIn('ClientAreaHeadOutput', hooks)
        self.assertIn('ClientAreaFooterOutput', hooks)
        self.assertIn("return '';", hooks)
        for banned in ('file_put_contents', 'unlink', 'rename', 'copy('):
            self.assertNotIn(banned, hooks, banned)

    def test_no_protected_theme_file_is_referenced_for_writing(self):
        for path in PHP_SOURCES + [ROOT / 'builder-page.php']:
            code = strip_comments(path.read_text())
            self.assertNotIn('templates/cloudhost247_legacy', code, str(path))
            self.assertNotIn('templates/orderforms', code, str(path))

    # ------------------------------------------------------------------ gates
    def test_registered_in_the_release_gates(self):
        check = (ROOT / 'scripts/release-candidate-check.sh').read_text()
        self.assertIn('tests/builder/run.php', check)
        self.assertIn('tests/builder/test_static.py', check)
        self.assertIn('builder-page.php', check)

        workflow = (ROOT / '.github/workflows/independent-foundation.yml').read_text()
        self.assertIn('tests/builder/run.php', workflow)
        self.assertIn('builder-page.php', workflow)

        migrations = (ROOT / 'scripts/validate-migrations.py').read_text()
        self.assertIn("'cloudhost247_builder'", migrations)

        security = (ROOT / 'tests/security/test_security.py').read_text()
        self.assertIn('cloudhost247_builder', security)

        foundation = (ROOT / 'tests/foundation/test_static.py').read_text()
        self.assertIn('cloudhost247_builder', foundation)

        core = (ROOT / 'modules/addons/cloudhost247_core/cloudhost247_core.php').read_text()
        self.assertIn('cloudhost247_builder', core)

    def test_documentation_exists_and_matches(self):
        doc = DOCS / 'WEBSITE-BUILDER.md'
        self.assertTrue(doc.is_file())
        text = doc.read_text()
        for heading in ('Page schema', 'Widget library', 'Publishing', 'Security', 'Testing'):
            self.assertIn(heading, text, heading)
        run = (ROOT / 'tests/builder/run.php').read_text()
        assertions = run.count('$check(') - 1
        self.assertGreater(assertions, 200)

    def test_readme_declares_the_module(self):
        readme = (ROOT / 'README.md').read_text()
        self.assertIn('cloudhost247_builder', readme)


if __name__ == '__main__':
    unittest.main()
