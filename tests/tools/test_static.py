#!/usr/bin/env python3
"""Static verification for the CloudHost247 Tools Platform.

Asserts the hardening invariants agreed for the module:
  1. structure  — expected files exist (entry, bootstrap, migration, API,
     templates, assets, every tool category implementation)
  2. security   — no shell execution anywhere, TLS verification enforced on
     every outbound cURL call, CSRF-protected admin mutations, proxy-header
     trust behind an explicit setting, no default REST API token
  3. registry   — every registered tool id is charset-safe and has a handler
  4. templates  — every Smarty output is escaped
  5. AJAX/API   — both surfaces dispatch through the shared executor with a
     documented cache policy
  6. migration  — guarded, namespaced, non-destructive (mirrors the repo gate)
"""

import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ADDON = os.path.join(ROOT, "modules", "addons", "cloudhost247_tools")

EXPECTED_FILES = [
    os.path.join(ADDON, "cloudhost247_tools.php"),
    os.path.join(ADDON, "bootstrap.php"),
    os.path.join(ADDON, "hooks.php"),
    os.path.join(ADDON, "migrations", "V227.php"),
    os.path.join(ADDON, "includes", "functions.php"),
    os.path.join(ADDON, "includes", "classes.php"),
    os.path.join(ADDON, "includes", "api.php"),
    os.path.join(ADDON, "includes", "dns_client.php"),
    os.path.join(ADDON, "api", "index.php"),
    os.path.join(ADDON, "templates", "client", "dashboard.tpl"),
    os.path.join(ADDON, "templates", "client", "category.tpl"),
    os.path.join(ADDON, "templates", "client", "tool.tpl"),
    os.path.join(ADDON, "assets", "css", "cloudhost247-tools.css"),
    os.path.join(ADDON, "assets", "js", "cloudhost247-tools.js"),
    os.path.join(ADDON, "includes", "tools", "dns_tools.php"),
    os.path.join(ADDON, "includes", "tools", "ip_tools.php"),
    os.path.join(ADDON, "includes", "tools", "developer_tools.php"),
    os.path.join(ADDON, "includes", "tools", "designer_tools.php"),
    os.path.join(ADDON, "includes", "tools", "webmaster_tools.php"),
    os.path.join(ADDON, "includes", "tools", "network_tools.php"),
    os.path.join(ADDON, "includes", "tools", "security_tools.php"),
    os.path.join(ADDON, "includes", "tools", "productivity_tools.php"),
    os.path.join(ADDON, "includes", "tools", "gaming_tools.php"),
]

TOOL_CATEGORIES = ["dns", "ip", "developer", "designer", "webmaster", "network", "security", "productivity", "gaming"]


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def php_sources():
    for base, _dirs, files in os.walk(ADDON):
        for name in files:
            if name.endswith(".php"):
                yield os.path.join(base, name)


class ToolsPlatformStaticTests(unittest.TestCase):
    def test_expected_files_exist(self):
        for path in EXPECTED_FILES:
            self.assertTrue(os.path.isfile(path), path)

    def test_no_shell_execution_or_unsafe_calls(self):
        bad = re.compile(r"\b(eval|exec|shell_exec|system|passthru|proc_open|popen|unserialize)\s*\(", re.I)
        for path in php_sources():
            self.assertIsNone(bad.search(read(path)), path)

    def test_tls_verification_is_enforced_everywhere(self):
        for path in php_sources():
            self.assertNotIn("CURLOPT_SSL_VERIFYPEER, false", read(path), path)
        functions = read(os.path.join(ADDON, "includes", "functions.php"))
        self.assertIn("CURLOPT_SSL_VERIFYPEER, true", functions)
        self.assertIn("CURLOPT_SSL_VERIFYHOST, 2", functions)
        # curl helper refuses non-HTTP(S) schemes (no file:// / gopher:// SSRF)
        self.assertRegex(functions, r"Unsupported URL scheme")
        # GeoIP lookups go over HTTPS only
        ip_tools = read(os.path.join(ADDON, "includes", "tools", "ip_tools.php"))
        self.assertNotIn('"http://ip-api.com', ip_tools)

    def test_propagation_checker_is_pure_php(self):
        dns_tools = read(os.path.join(ADDON, "includes", "tools", "dns_tools.php"))
        self.assertIn("CloudHost247ToolsDnsClient::query", dns_tools)
        self.assertNotRegex(dns_tools, r"\bdig\b.*escapeshellarg|escapeshellarg.*\bdig\b")
        self.assertNotIn("safe_exec", dns_tools)

    def test_admin_mutations_are_token_protected(self):
        classes = read(os.path.join(ADDON, "includes", "classes.php"))
        self.assertIn("AdminGuard::requirePostToken()", classes)
        self.assertIn('name="token"', classes)
        # cache clearing is a POST, not a state-changing GET link
        self.assertNotIn("&clear_cache=1", classes)

    def test_proxy_header_trust_is_opt_in(self):
        functions = read(os.path.join(ADDON, "includes", "functions.php"))
        self.assertIn("'trust_proxy_headers'", functions)
        self.assertIn("HTTP_CF_CONNECTING_IP", functions)
        # default key list must start with REMOTE_ADDR
        match = re.search(r"\$keys = \['REMOTE_ADDR'\];", functions)
        self.assertIsNotNone(match)

    def test_rest_api_has_no_default_token_and_uses_hash_equals(self):
        api_support = read(os.path.join(ADDON, "includes", "api.php"))
        self.assertIn("hash_equals", api_support)
        self.assertIn("api_token", api_support)
        entry = read(os.path.join(ADDON, "cloudhost247_tools.php"))
        self.assertRegex(entry, r"(?s)'api_token'.*?'Default' => ''", "api_token must ship empty (disabled)")
        endpoint = read(os.path.join(ADDON, "api", "index.php"))
        self.assertIn("init.php", endpoint)
        self.assertIn("cloudhost247_tools_api_respond(401", endpoint)

    def test_ajax_and_rest_share_one_executor_with_cache_policy(self):
        classes = read(os.path.join(ADDON, "includes", "classes.php"))
        self.assertIn("cloudhost247_tools_execute_tool(", classes)
        api_support = read(os.path.join(ADDON, "includes", "api.php"))
        self.assertIn("cloudhost247_tools_execute_tool(", api_support)
        self.assertIn("cloudhost247_tools_cache_exempt_tools", api_support)
        for tool in ("what_is_my_ip", "online_notepad", "password_generator"):
            self.assertIn("'" + tool + "'", api_support)

    def test_every_registered_tool_is_charset_safe_and_implemented(self):
        entry = read(os.path.join(ADDON, "cloudhost247_tools.php"))
        tool_files = "".join(read(p) for p in php_sources() if os.sep + "tools" + os.sep in p)
        registry = entry.split("function cloudhost247_tools_get_all_tools", 1)[1]
        ids = re.findall(r"'([a-z0-9_]+)' => \['name' =>", registry)
        self.assertGreaterEqual(len(ids), 79, "full catalogue must stay registered")
        for tool_id in ids:
            self.assertRegex(tool_id, r"^[a-z0-9_]+$")
            handler = "function cloudhost247_tool_" + tool_id + "("
            self.assertIn(handler, tool_files, tool_id)

    def test_categories_match_the_specification(self):
        entry = read(os.path.join(ADDON, "cloudhost247_tools.php"))
        registry = entry.split("function cloudhost247_tools_get_all_tools", 1)[1]
        for category in TOOL_CATEGORIES:
            self.assertIn("'" + category + "' => [", registry)

    def test_client_templates_escape_every_output(self):
        for name in ("dashboard.tpl", "category.tpl", "tool.tpl"):
            tpl = read(os.path.join(ADDON, "templates", "client", name))
            # variable outputs and function outputs must carry |escape
            for m in re.finditer(r"\{(\$[A-Za-z_][A-Za-z0-9_.]*(?:\([^()]*\))?)\}", tpl):
                self.fail("{0}: unescaped variable output {1}".format(name, m.group(0)))
            for m in re.finditer(r"\{((?:ucfirst|strtolower)\([^)]+\))\}", tpl):
                self.fail("{0}: unescaped function output {1}".format(name, m.group(0)))
            # raw JS string interpolation only for registry ids (charset-locked elsewhere)
            self.assertNotIn("{{", tpl)

    def test_js_renderers_escape_tool_output(self):
        js = read(os.path.join(ADDON, "assets", "js", "cloudhost247-tools.js"))
        self.assertIn("function escapeHtml(", js)
        self.assertIn(".map(escapeHtml)", js)
        self.assertNotIn("records.join(', ')", js)

    def test_migration_is_guarded_namespaced_and_non_destructive(self):
        migration = read(os.path.join(ADDON, "migrations", "V227.php"))
        self.assertIn("return '2.2.7'", migration)
        creates = len(re.findall(r"->create\(", migration))
        guards = len(re.findall(r"hasTable\(", migration))
        self.assertGreaterEqual(guards, creates)
        self.assertNotRegex(migration, r"->(drop|rename)\s*\(")
        self.assertRegex(migration, r"create\('mod_cloudhost247_tools_")
        self.assertNotRegex(migration, r"create\('(?!mod_cloudhost247_tools_)")

    def test_activation_uses_the_foundation_migration_runner(self):
        entry = read(os.path.join(ADDON, "cloudhost247_tools.php"))
        self.assertIn("MigrationRunner", entry)
        self.assertIn("InitialMigration", entry)
        self.assertIn("'version' => '2.2.7'", entry)

    def test_deactivation_never_drops_data(self):
        entry = read(os.path.join(ADDON, "cloudhost247_tools.php"))
        deactivate = entry.split("function cloudhost247_tools_deactivate", 1)[1].split("function ", 1)[0]
        self.assertNotRegex(deactivate, r"->drop\(|dropIfExists|truncate")
        self.assertIn("preserved", deactivate.lower())

    def test_hooks_only_register_whmcs_hook_callbacks(self):
        hooks = read(os.path.join(ADDON, "hooks.php"))
        self.assertIn("add_hook('ClientAreaHeadOutput'", hooks)
        self.assertNotRegex(hooks, r"\b(eval|exec|shell_exec|system)\s*\(", re.I)

    def test_public_mrz_surfaces_publish_no_specimen_persona(self):
        """The MRZ tool must never ship a filled-in identity string.

        config/tools.php and the theme resources are public files (they are served, indexed and
        read by the footer/menu renderers), and the Node projection is compiled into the browser
        bundle. The ICAO Doc 9303 specimen document number, birth date, expiry, optional data and
        name may appear in tests and developer documentation, but a placeholder is a shape hint:
        the ready-made specimen is produced locally by the page's own test-data button.
        """
        forbidden = (
            "L898902C3",          # specimen document number
            "740812",             # specimen date of birth
            "120415",             # specimen expiry date
            "ZE184226B",          # specimen optional data
            "Eriksson",           # specimen surname
            "Anna Maria",         # specimen given names
            "P<UTO",              # first line of the specimen zone
        )
        surfaces = (
            os.path.join(ROOT, "config", "tools.php"),
            os.path.join(ROOT, "config", "tools-index.json"),
            os.path.join(ROOT, "config", "required-tools.json"),
            os.path.join(ROOT, "modules", "addons", "cloudhost247_theme", "resources", "tools.json"),
            os.path.join(ROOT, "modules", "addons", "cloudhost247_theme", "resources", "tools-public.json"),
            os.path.join(ROOT, "modules", "addons", "cloudhost247_theme", "resources", "site.json"),
        )
        for path in surfaces:
            self.assertTrue(os.path.isfile(path), path)
            text = read(path)
            for token in forbidden:
                self.assertNotIn(token, text, "%s leaks the MRZ specimen token %r" % (path, token))
        # The generator itself must keep the placeholder values shape-only, so a regeneration
        # cannot reintroduce a filled-in specimen into every surface above at once.
        generator = read(os.path.join(ROOT, "scripts", "generate-global-platform.py"))
        mrz_fields = generator.split("MRZ = [", 1)[1].split("]", 1)[0]
        for token in forbidden:
            self.assertNotIn(token, mrz_fields, "MRZ placeholder tuples reintroduce %r" % (token,))
        self.assertIn('"YYMMDD"', mrz_fields)

    def test_duplicate_capitalized_module_is_gone(self):
        self.assertFalse(os.path.exists(os.path.join(ROOT, "modules", "addons", "CloudHost247_tools")),
                         "the duplicate CloudHost247_tools module must not be resurrected")

    def test_behavior_suite_covers_the_module(self):
        suite = read(os.path.join(ROOT, "tests", "tools", "run.php"))
        for marker in ("cloudhost247_tools_execute_tool", "CloudHost247ToolsDnsClient", "cloudhost247_tools_api_dispatch",
                       "cloudhost247_tools_activate", "CH247FakeQuery"):
            self.assertIn(marker, suite)

    def test_repository_gates_include_the_module(self):
        rc_check = read(os.path.join(ROOT, "scripts", "release-candidate-check.sh"))
        self.assertIn("tests/tools/run.php", rc_check)
        self.assertIn("tests/tools/test_static.py", rc_check)
        workflow = read(os.path.join(ROOT, ".github", "workflows", "independent-foundation.yml"))
        self.assertIn("tests/tools/run.php", workflow)
        security = read(os.path.join(ROOT, "tests", "security", "test_security.py"))
        self.assertIn("modules/addons/cloudhost247_tools'", security)
        migrations = read(os.path.join(ROOT, "scripts", "validate-migrations.py"))
        self.assertIn("'cloudhost247_tools'", migrations)


if __name__ == "__main__":
    unittest.main()
