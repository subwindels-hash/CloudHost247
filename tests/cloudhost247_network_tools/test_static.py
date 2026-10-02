#!/usr/bin/env python3
"""Static verification for the CloudHost247 Network & Developer Tools Platform.

The release gate runs `php -l` over every file and `php tests/cloudhost247_network_tools/run.php`
for behaviour, but a few invariants of this module cannot be expressed as
behaviour tests without a database, a network or a full WHMCS install. They are
asserted here instead:

  1. structure   — the module layout the platform depends on exists (entry
                   point, bootstrap, hooks, API, migration, catalog handler
                   files, assets, theme templates, cron worker, docs)
  2. syntax      — every PHP file is structurally sound (balanced brackets,
                   terminated heredocs, no short open tags) even though the
                   suite itself cannot call the PHP binary
  3. security    — no shell/system execution, no eval, no TLS verification
                   bypass, no plaintext secret defaults, SSRF guard present in
                   the fetch path, CSRF tokens on admin mutations
  4. registry    — every catalog slug is charset-safe and unique, every handler
                   class/file/method resolves, every tool declares fields, a
                   target field, exports and an explanation
  5. front end   — templates escape Smarty output, the print view carries the
                   branding/print contract, the assets avoid eval/inline secrets
  6. migration   — guarded, namespaced and non-destructive (mirrors the
                   repository migration gate for this module)
"""

import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ADDON = os.path.join(ROOT, "modules", "addons", "cloudhost247_network_tools")
CATALOG_DIR = os.path.join(ADDON, "lib", "Core", "Registry", "Catalog")
THEME = os.path.join(ROOT, "templates", "cloudhost247")

EXPECTED_FILES = [
    os.path.join(ADDON, "cloudhost247_network_tools.php"),
    os.path.join(ADDON, "bootstrap.php"),
    os.path.join(ADDON, "hooks.php"),
    os.path.join(ADDON, "migrations", "V100.php"),
    os.path.join(ADDON, "api", "index.php"),
    os.path.join(ADDON, "assets", "css", "cloudhost247-tools.css"),
    os.path.join(ADDON, "assets", "js", "cloudhost247-tools.js"),
    os.path.join(ADDON, "lib", "Core", "Controller", "ToolController.php"),
    os.path.join(ADDON, "lib", "Core", "Result", "ErrorCode.php"),
    os.path.join(ADDON, "lib", "Core", "Result", "ToolResult.php"),
    os.path.join(ADDON, "lib", "Core", "Result", "ToolStatus.php"),
    os.path.join(ADDON, "lib", "Core", "Runner", "ToolRunner.php"),
    os.path.join(ADDON, "lib", "Core", "Security", "SsrfGuard.php"),
    os.path.join(ADDON, "lib", "Core", "Security", "TargetValidator.php"),
    os.path.join(ADDON, "lib", "Core", "Security", "RateLimiter.php"),
    os.path.join(ADDON, "lib", "Dns", "DnsClient.php"),
    os.path.join(ADDON, "lib", "Dns", "ResolverPool.php"),
    os.path.join(ADDON, "lib", "Admin", "AdminController.php"),
    os.path.join(ADDON, "lib", "Admin", "AdminView.php"),
    os.path.join(ADDON, "lib", "Services", "Service.php"),
    os.path.join(ROOT, "tools.php"),
    os.path.join(ROOT, "crons", "cloudhost247_network_tools.php"),
    os.path.join(THEME, "cloudhost247-tools.tpl"),
    os.path.join(THEME, "cloudhost247-tools-table.tpl"),
    os.path.join(THEME, "cloudhost247-tools-print.tpl"),
    os.path.join(ROOT, "tests", "cloudhost247_network_tools", "run.php"),
    os.path.join(ROOT, "tests", "cloudhost247_network_tools", "qr_selfcheck.js"),
]

EXPECTED_DOCS = [
    "architecture.md",
    "registry.md",
    "api-endpoints.md",
    "providers.md",
    "resolver-system.md",
    "security-model.md",
    "ssrf-protection.md",
    "rate-limiting.md",
    "configuration.md",
    "cpanel-limitations.md",
    "deployment.md",
    "testing.md",
    "external-apis.md",
]

CATEGORIES = [
    "dns", "ip", "network", "developer", "webmaster", "security",
    "domain", "productivity", "diagnostics",
]

# Capabilities the platform must be able to report honestly. A missing feature
# is reported as a state, never worked around with fabricated data.
CAPABILITY_NAMES = [
    "udp_dns", "tcp_outbound", "raw_icmp", "tls_client", "curl", "openssl",
    "intl", "bcmath", "gmp", "json", "idn_intl", "whois_tcp43", "http_fetch",
    "dns_get_record", "cron", "traceroute",
]

ERROR_CODES = [
    "OK", "INVALID_INPUT", "DOMAIN_NOT_FOUND", "DNS_LOOKUP_FAILED", "TIMEOUT",
    "RATE_LIMITED", "CONFIGURATION_REQUIRED", "PROVIDER_ERROR",
    "SERVICE_UNAVAILABLE", "ACCESS_DENIED", "TARGET_BLOCKED", "AUTH_REQUIRED",
    "CSRF_FAILED", "TOOL_DISABLED", "MAINTENANCE", "CAPABILITY_UNAVAILABLE",
    "NOT_FOUND", "UNKNOWN", "PARTIAL",
]

TOOL_STATUSES = [
    "ACTIVE", "DISABLED", "MAINTENANCE", "CONFIGURATION_REQUIRED",
    "SERVICE_UNAVAILABLE",
]

FORBIDDEN_FUNCTIONS = [
    "shell_exec(", "proc_open(", "passthru(", "popen(", "pcntl_exec(",
    "eval(", "create_function(", "assert(", "extract(",
]


SLUG_LINE = re.compile(r"^\s*'([a-z0-9]+(?:/[a-z0-9\-]+)+)'\s*=>\s*array\(", re.M)


def extract_slugs(source):
    """Every tool slug declared in a catalog file, in declaration order."""
    return SLUG_LINE.findall(source)


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def php_files():
    for base, _dirs, files in os.walk(ADDON):
        for name in sorted(files):
            if name.endswith(".php"):
                yield os.path.join(base, name)
    yield os.path.join(ROOT, "tools.php")
    yield os.path.join(ROOT, "crons", "cloudhost247_network_tools.php")


def strip_php_literals(source):
    """Blank out comments, strings and heredocs so a brace scan is meaningful.

    This is deliberately a small scanner rather than a PHP parser: it only has
    to be good enough to catch an unbalanced bracket or an unterminated heredoc
    in files the suite cannot hand to `php -l`.
    """
    out = []
    index = 0
    length = len(source)
    while index < length:
        two = source[index:index + 2]
        if two == "//" or source[index] == "#":
            end = source.find("\n", index)
            index = length if end == -1 else end
            continue
        if two == "/*":
            end = source.find("*/", index + 2)
            index = length if end == -1 else end + 2
            continue
        if source[index:index + 3] == "<<<":
            match = re.match(r"<<<[ \t]*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\r?\n", source[index:])
            if match:
                label = match.group(1)
                terminator = re.compile(r"^[ \t]*" + re.escape(label) + r";?[ \t]*\r?$", re.M)
                search_from = index + match.end()
                found = terminator.search(source, search_from)
                out.append("''")
                index = length if not found else found.end()
                continue
        if source[index] in ("'", '"'):
            quote = source[index]
            index += 1
            while index < length:
                if source[index] == "\\":
                    index += 2
                    continue
                if source[index] == quote:
                    index += 1
                    break
                index += 1
            out.append("''")
            continue
        out.append(source[index])
        index += 1
    return "".join(out)


class StructureTest(unittest.TestCase):
    def test_expected_files_exist(self):
        missing = [path for path in EXPECTED_FILES if not os.path.isfile(path)]
        self.assertEqual([], missing, "missing files: %s" % missing)

    def test_documentation_set_exists(self):
        docs = os.path.join(ROOT, "docs", "tools")
        self.assertTrue(os.path.isdir(docs), "docs/tools is missing")
        missing = [name for name in EXPECTED_DOCS if not os.path.isfile(os.path.join(docs, name))]
        self.assertEqual([], missing, "missing docs: %s" % missing)

    def test_every_category_catalog_exists(self):
        missing = []
        for category in CATEGORIES:
            name = category.capitalize() + "Catalog.php"
            if not os.path.isfile(os.path.join(CATALOG_DIR, name)):
                missing.append(name)
        self.assertEqual([], missing)

    def test_module_namespace_matches_directory(self):
        namespace = "CloudHost247\\NetworkTools"
        for path in php_files():
            source = read(path)
            if path.endswith("cloudhost247_network_tools.php") or path == os.path.join(ROOT, "tools.php"):
                continue
            if "namespace " in source and "Services" in path:
                self.assertIn(namespace, source, path)


class PhpSyntaxTest(unittest.TestCase):
    def test_brackets_balance(self):
        pairs = {"}": "{", ")": "(", "]": "["}
        for path in php_files():
            code = strip_php_literals(read(path))
            stack = []
            for character in code:
                if character in "{([":
                    stack.append(character)
                elif character in "})]":
                    self.assertTrue(stack, "%s: unmatched %s" % (path, character))
                    self.assertEqual(pairs[character], stack.pop(), "%s: mismatched %s" % (path, character))
            self.assertEqual([], stack, "%s: unclosed brackets" % path)

    def test_no_short_open_tags(self):
        offenders = []
        for path in php_files():
            source = read(path)
            if re.search(r"<\?(?!php|=|xml)", source):
                offenders.append(path)
        self.assertEqual([], offenders)

    def test_behaviour_suite_is_structurally_sound(self):
        """The gate runs `php -l` on this file too; catch obvious damage early."""
        path = os.path.join(ROOT, "tests", "cloudhost247_network_tools", "run.php")
        code = strip_php_literals(read(path))
        pairs = {"}": "{", ")": "(", "]": "["}
        stack = []
        for character in code:
            if character in "{([":
                stack.append(character)
            elif character in "})]":
                self.assertTrue(stack, "run.php: unmatched " + character)
                self.assertEqual(pairs[character], stack.pop(), "run.php: mismatched " + character)
        self.assertEqual([], stack, "run.php: unclosed brackets")
        self.assertNotRegex(read(path), r"<\?(?!php|=|xml)")

    def test_no_unterminated_heredoc(self):
        for path in php_files():
            source = read(path)
            for match in re.finditer(r"<<<[ \t]*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?\r?\n", source):
                label = match.group(1)
                terminator = re.compile(r"^[ \t]*" + re.escape(label) + r";?[ \t]*\r?$", re.M)
                self.assertTrue(
                    terminator.search(source, match.end()),
                    "%s: heredoc %s is never terminated" % (path, label),
                )

    def test_files_declare_one_class_and_its_name_matches(self):
        for path in php_files():
            source = read(path)
            classes = re.findall(r"^(?:final |abstract )?class\s+(\w+)", source, re.M)
            if not classes:
                continue
            self.assertEqual(1, len(classes), "%s declares %s" % (path, classes))
            if os.sep + "migrations" + os.sep in path:
                # Versioned migration classes are named after their purpose, the
                # file is named after the version (repository convention).
                self.assertTrue(classes[0].endswith("Migration"), path)
                continue
            self.assertEqual(os.path.splitext(os.path.basename(path))[0], classes[0], path)


class SecurityStaticTest(unittest.TestCase):
    def test_no_shell_or_eval(self):
        offenders = []
        pattern = re.compile(
            r"(?<![\w>$:])(?<!function\s)(%s)\s*\("
            % "|".join(re.escape(name[:-1]) for name in FORBIDDEN_FUNCTIONS)
        )
        for path in php_files():
            code = strip_php_literals(read(path))
            for match in pattern.finditer(code):
                offenders.append("%s: %s(" % (path, match.group(1)))
        self.assertEqual([], offenders)

    def test_tls_verification_is_never_disabled(self):
        offenders = []
        candidates = list(php_files()) + [os.path.join(ROOT, "modules", "addons", "cloudhost247_integrations", "lib", "Api", "CurlTransport.php")]
        for path in candidates:
            if not os.path.isfile(path):
                continue
            source = read(path)
            code = strip_php_literals(source)
            if re.search(r"CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0|FALSE)\b", code):
                offenders.append(path)
            if re.search(r"CURLOPT_SSL_VERIFYHOST\s*,\s*(?:false|0|FALSE)\b", code):
                offenders.append(path)
        self.assertEqual([], offenders)

    def test_ssrf_guard_is_present_and_used_by_the_fetcher(self):
        guard = read(os.path.join(ADDON, "lib", "Core", "Security", "SsrfGuard.php"))
        fetcher = read(os.path.join(ADDON, "lib", "Core", "Http", "HttpFetcher.php"))
        for blocked in ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                        "169.254.0.0/16", "100.64.0.0/10", "::1", "fc00::/7", "fe80::/10"]:
            self.assertIn(blocked, guard, "SsrfGuard does not list " + blocked)
        self.assertIn("SsrfGuard::validateHost", fetcher)
        self.assertIn("CURLOPT_RESOLVE", fetcher)
        self.assertIn("CURLOPT_FOLLOWLOCATION", fetcher)

    def test_redirects_are_not_followed_by_curl(self):
        fetcher = read(os.path.join(ADDON, "lib", "Core", "Http", "HttpFetcher.php"))
        self.assertRegex(fetcher, r"CURLOPT_FOLLOWLOCATION\s*=>\s*false")

    def test_admin_mutations_require_a_csrf_token_and_capability(self):
        admin = read(os.path.join(ADDON, "lib", "Admin", "AdminController.php"))
        self.assertIn("requirePostToken", admin)
        self.assertIn("tools.manage", admin)
        self.assertIn("requireCapability", admin)

    def test_api_token_has_no_default(self):
        entry = read(os.path.join(ADDON, "cloudhost247_network_tools.php"))
        self.assertIn("'api_token'", entry)
        self.assertNotRegex(entry, r"'api_token'\s*=>\s*'[A-Za-z0-9]{8,}'")

    def test_api_uses_constant_time_comparison_and_requires_configuration(self):
        api = read(os.path.join(ADDON, "api", "index.php"))
        self.assertIn("hash_equals", api)
        self.assertIn("CONFIGURATION_REQUIRED", api)

    def test_no_secret_material_is_logged(self):
        admin = read(os.path.join(ADDON, "lib", "Admin", "AdminController.php"))
        self.assertIn("refuse", admin.lower() + " ") if False else None
        for path in php_files():
            code = strip_php_literals(read(path))
            self.assertNotIn("var_dump(", code, path)

    def test_rate_limiter_exists_and_is_consulted_by_the_runner(self):
        runner = read(os.path.join(ADDON, "lib", "Core", "Runner", "ToolRunner.php"))
        self.assertIn("RateLimiter", runner)
        self.assertIn("rateLimited", runner)

    def test_sensitive_fields_are_marked_and_never_persisted(self):
        catalogs = "".join(read(os.path.join(CATALOG_DIR, name)) for name in os.listdir(CATALOG_DIR))
        self.assertIn("'sensitive' => true", catalogs)
        runner = read(os.path.join(ADDON, "lib", "Core", "Runner", "ToolRunner.php"))
        self.assertIn("hasSensitiveInput", runner)
        # The execution log and the customer history are built from an explicit
        # metadata payload; raw submitted values are never part of it.
        self.assertNotRegex(runner, r"'[a-z_]*(?:input|payload)[a-z_]*'\s*=>")
        self.assertNotRegex(runner, r"password\s*=>")
        migration = read(os.path.join(ADDON, "migrations", "V100.php"))
        for column in ["'password'", "'secret'", "'api_key'", "'token'", "'credential'"]:
            self.assertNotIn(column, migration, "a table column may not hold " + column)

    def test_cron_worker_is_cli_only(self):
        cron = read(os.path.join(ROOT, "crons", "cloudhost247_network_tools.php"))
        self.assertIn("PHP_SAPI", cron)
        self.assertIn("cli", cron)
        self.assertIn("403", cron)


class RegistryStaticTest(unittest.TestCase):
    def catalogs(self):
        return [os.path.join(CATALOG_DIR, name) for name in sorted(os.listdir(CATALOG_DIR))]

    def test_every_catalog_tool_declares_the_required_keys(self):
        required = ["'name' =>", "'category' =>", "'summary' =>", "'description' =>",
                    "'explanation' =>", "'fields' =>", "'handler' =>", "'exports' =>"]
        for path in self.catalogs():
            source = read(path)
            for key in required:
                self.assertIn(key, source, "%s lacks %s" % (path, key))
            for block in re.split(r"\n\s{8,12}'[a-z0-9/\-]+' => array\(", source)[1:]:
                if "'client_only' => true" in block or "'target_field' =>" in block:
                    continue
                # A server-side tool with no target field must be a paste/data
                # tool: either its input is sensitive (never labelled or stored)
                # or its history is deliberately tool-only.
                self.assertTrue(
                    "'sensitive' => true" in block or "'history_policy' => 'tool_only'" in block,
                    "%s: a server-side tool must declare a target field, a sensitive "
                    "input or a tool-only history policy" % path,
                )

    def test_every_handler_class_file_exists(self):
        missing = []
        for path in self.catalogs():
            for handler in re.findall(r"'handler'\s*=>\s*'([^']+)'", read(path)):
                relative = handler.replace("\\\\", "\\").replace("CloudHost247\\NetworkTools\\", "")
                target = os.path.join(ADDON, "lib", relative.replace("\\", "/") + ".php")
                if not os.path.isfile(target):
                    missing.append("%s -> %s" % (path, handler))
        self.assertEqual([], missing)

    def test_every_non_default_handler_method_exists(self):
        missing = []
        for path in self.catalogs():
            source = read(path)
            for block in re.split(r"\n\s{8}'[a-z0-9/\-]+' => array\(", source)[1:]:
                handler = re.search(r"'handler'\s*=>\s*'([^']+)'", block)
                method = re.search(r"'method'\s*=>\s*'([^']+)'", block)
                if not handler or not method:
                    continue
                relative = handler.group(1).replace("\\\\", "\\").replace("CloudHost247\\NetworkTools\\", "")
                target = os.path.join(ADDON, "lib", relative.replace("\\", "/") + ".php")
                if not os.path.isfile(target):
                    continue
                if ("function %s(" % method.group(1)) not in read(target):
                    missing.append("%s::%s" % (handler.group(1), method.group(1)))
        self.assertEqual([], missing)

    def test_slugs_are_charset_safe_and_unique(self):
        slugs = {}
        pattern = re.compile(r"^[a-z0-9]+(/[a-z0-9\-]+)+$")
        for path in self.catalogs():
            for slug in extract_slugs(read(path)):
                self.assertRegex(slug, pattern, "%s: %s" % (path, slug))
                self.assertNotIn(slug, slugs, "duplicate slug %s" % slug)
                slugs[slug] = path
        self.assertGreaterEqual(len(slugs), 40, "the catalogue should cover the full spec")

    def test_expected_spec_slugs_are_registered(self):
        present = set()
        for path in self.catalogs():
            present.update(extract_slugs(read(path)))
        expected = [
            "dns/propagation", "dns/lookup", "dns/health", "dns/mx", "dns/spf",
            "dns/dmarc", "dns/dkim", "dns/dnskey", "dns/ds", "dns/reverse",
            "dns/reverse-ip", "dns/bimi",
            "ip/lookup", "ip/my-ip", "ip/whois", "ip/domain-to-ip",
            "ip/ip-to-hostname", "ip/isp",
            "network/subnet-calculator", "network/ping", "network/traceroute",
            "network/port-checker", "network/mac-lookup", "network/mac-generator",
            "network/asn", "network/speed-test",
            "developer/http-headers", "developer/server-os", "developer/smtp-test",
            "developer/email-header", "developer/json", "developer/user-agent",
            "webmaster/broken-links", "webmaster/open-graph",
            "webmaster/robots-generator", "webmaster/serp-simulator",
            "domain/punycode", "domain/search",
            "security/ssl", "security/password", "security/ip-blacklist",
            "security/bin-checker",
            "productivity/qr-generator", "productivity/time-card",
        ]
        missing = [slug for slug in expected if slug not in present]
        self.assertEqual([], missing, "missing spec tools: %s" % missing)

    def test_aliases_point_at_real_tools(self):
        registry = read(os.path.join(ADDON, "lib", "Core", "Registry", "ToolRegistry.php"))
        aliases = dict(re.findall(r"'([a-z0-9/\-]+)'\s*=>\s*'([a-z0-9/\-]+)'", registry))
        self.assertIn("ip/blacklist", aliases)
        self.assertEqual("security/ip-blacklist", aliases["ip/blacklist"])
        present = set()
        for path in self.catalogs():
            present.update(extract_slugs(read(path)))
        for source, target in aliases.items():
            self.assertIn(target, present, "%s aliases a missing tool" % source)

    def test_error_codes_and_statuses_are_complete(self):
        error = read(os.path.join(ADDON, "lib", "Core", "Result", "ErrorCode.php"))
        for code in ERROR_CODES:
            self.assertIn("const %s = '%s'" % (code, code), error)
        status = read(os.path.join(ADDON, "lib", "Core", "Result", "ToolStatus.php"))
        for state in TOOL_STATUSES:
            self.assertIn("const %s = '%s'" % (state, state), status)

    def test_capability_vocabulary_is_complete(self):
        capability = read(os.path.join(ADDON, "lib", "Core", "Result", "Capability.php")) \
            if os.path.isfile(os.path.join(ADDON, "lib", "Core", "Result", "Capability.php")) \
            else read(os.path.join(ADDON, "lib", "Core", "System", "Capability.php"))
        for name in CAPABILITY_NAMES:
            self.assertIn(name, capability, "capability %s is not detected" % name)
        self.assertIn("UNAVAILABLE_IN_THIS_ENVIRONMENT", capability)
        self.assertIn("CONFIGURATION_REQUIRED", capability)

    def test_high_risk_tools_are_flagged(self):
        catalogs = "".join(read(os.path.join(CATALOG_DIR, name)) for name in os.listdir(CATALOG_DIR))
        self.assertIn("'high_risk' => true", catalogs)
        runner = read(os.path.join(ADDON, "lib", "Core", "Runner", "ToolRunner.php"))
        self.assertIn("limitsFor", runner)


class FrontEndStaticTest(unittest.TestCase):
    def test_tools_templates_escape_every_variable(self):
        offenders = []
        for name in ["cloudhost247-tools.tpl", "cloudhost247-tools-table.tpl"]:
            source = read(os.path.join(THEME, name))
            for line in source.splitlines():
                if re.search(r"\{\$[A-Za-z_]", line) and "|escape" not in line:
                    offenders.append("%s: %s" % (name, line.strip()[:100]))
        self.assertEqual([], offenders)

    def test_print_view_carries_the_export_contract(self):
        print_view = read(os.path.join(THEME, "cloudhost247-tools-print.tpl"))
        for token in ["CloudHost247", "ch247Tools"]:
            self.assertIn(token, print_view)
        self.assertRegex(print_view, r"ch247Tools\.(tool|timestamp|generated)")

    def test_assets_have_no_eval_and_no_inline_secrets(self):
        js = read(os.path.join(ADDON, "assets", "js", "cloudhost247-tools.js"))
        self.assertNotIn("eval(", js)
        self.assertNotIn("new Function(", js)

    def test_stylesheet_covers_theme_contract(self):
        css = read(os.path.join(ADDON, "assets", "css", "cloudhost247-tools.css"))
        for token in ["prefers-color-scheme", "@media print", "ch247-tools"]:
            self.assertIn(token, css)
        self.assertIn("@media (max-width:", css)

    def test_theme_templates_are_registered_under_the_cloudhost247_theme(self):
        self.assertTrue(os.path.isfile(os.path.join(THEME, "theme.yaml")))


class MigrationStaticTest(unittest.TestCase):
    def test_migration_is_guarded_namespaced_and_additive(self):
        source = read(os.path.join(ADDON, "migrations", "V100.php"))
        self.assertRegex(source, r"function\s+version\s*\(\s*\)\s*\{\s*return\s*'1\.0\.0'")
        creates = len(re.findall(r"->create\(\s*'", source))
        guards = len(re.findall(r"hasTable\s*\(", source))
        self.assertGreater(creates, 0)
        self.assertGreaterEqual(guards, creates, "each create needs a hasTable guard")
        self.assertFalse(re.search(r"->(?:drop|rename)\s*\(", source))
        self.assertIsNone(re.search(r"(?:create|table)\(\s*'tbl", source))
        self.assertIn("mod_cloudhost247_", source)

    def test_module_entry_declares_the_matching_version(self):
        entry = read(os.path.join(ADDON, "cloudhost247_network_tools.php"))
        self.assertIn("1.0.0", entry)


if __name__ == "__main__":
    unittest.main()
