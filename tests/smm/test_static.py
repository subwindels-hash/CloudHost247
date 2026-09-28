#!/usr/bin/env python3
"""Static verification for the CloudHost247 SMM integration.

Asserts the module's security and architecture invariants:
  1. structure — expected files exist, all classes autoloable from their path
  2. interfaces — fakes and repositories implement every contract method the
     services call (this is what keeps the behavior suite honest)
  3. security — no dangerous calls, CSRF+auth guards in the admin controller,
     CLI-only cron, redaction wiring, HTTPS/SSRF policy in the transport
  4. templates — every Smarty variable is escaped
  5. migration — guarded, namespaced, non-destructive (mirrors the repo gate)
"""

import os
import re
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ADDON = os.path.join(ROOT, "modules", "addons", "cloudhost247_smm")
SERVER = os.path.join(ROOT, "modules", "servers", "cloudhost247_smm")
CRON = os.path.join(ROOT, "crons", "cloudhost247_smm.php")
TESTS = os.path.join(ROOT, "tests", "smm")

EXPECTED_FILES = [
    os.path.join(ADDON, "cloudhost247_smm.php"),
    os.path.join(ADDON, "bootstrap.php"),
    os.path.join(ADDON, "hooks.php"),
    os.path.join(ADDON, "README.md"),
    os.path.join(ADDON, "migrations", "V100.php"),
    os.path.join(ADDON, "lib", "Support", "ModuleException.php"),
    os.path.join(ADDON, "lib", "Support", "AdapterException.php"),
    os.path.join(ADDON, "lib", "Support", "TransportException.php"),
    os.path.join(ADDON, "lib", "Support", "HttpTransport.php"),
    os.path.join(ADDON, "lib", "Support", "CurlTransport.php"),
    os.path.join(ADDON, "lib", "Support", "UrlPolicy.php"),
    os.path.join(ADDON, "lib", "Support", "Crypto.php"),
    os.path.join(ADDON, "lib", "Support", "Redactor.php"),
    os.path.join(ADDON, "lib", "Support", "StatusMap.php"),
    os.path.join(ADDON, "lib", "Support", "Validator.php"),
    os.path.join(ADDON, "lib", "Adapters", "ProviderAdapter.php"),
    os.path.join(ADDON, "lib", "Adapters", "GenericSmmAdapter.php"),
    os.path.join(ADDON, "lib", "Adapters", "AdapterFactory.php"),
    os.path.join(ADDON, "lib", "Contracts", "ProviderFinder.php"),
    os.path.join(ADDON, "lib", "Contracts", "OrderStore.php"),
    os.path.join(ADDON, "lib", "Contracts", "ApiRecorder.php"),
    os.path.join(ADDON, "lib", "Repositories", "ProviderRepository.php"),
    os.path.join(ADDON, "lib", "Repositories", "OrderRepository.php"),
    os.path.join(ADDON, "lib", "Repositories", "LogRepository.php"),
    os.path.join(ADDON, "lib", "Services", "Settings.php"),
    os.path.join(ADDON, "lib", "Services", "ExecutionLock.php"),
    os.path.join(ADDON, "lib", "Services", "CatalogSync.php"),
    os.path.join(ADDON, "lib", "Services", "ProviderService.php"),
    os.path.join(ADDON, "lib", "Services", "SyncService.php"),
    os.path.join(ADDON, "lib", "Services", "MappingService.php"),
    os.path.join(ADDON, "lib", "Services", "OrderService.php"),
    os.path.join(ADDON, "lib", "Services", "StatusSyncService.php"),
    os.path.join(ADDON, "lib", "Services", "ReconciliationService.php"),
    os.path.join(ADDON, "lib", "Services", "ClientAreaService.php"),
    os.path.join(ADDON, "lib", "Services", "Automation.php"),
    os.path.join(ADDON, "lib", "Services", "AdminController.php"),
    os.path.join(ADDON, "lib", "Services", "AdminView.php"),
    os.path.join(ADDON, "templates", "orders.tpl"),
    os.path.join(SERVER, "cloudhost247_smm.php"),
    os.path.join(SERVER, "templates", "clientarea.tpl"),
    CRON,
    os.path.join(TESTS, "run.php"),
    os.path.join(TESTS, "fakes.php"),
    os.path.join(TESTS, "fixtures", "services.json"),
    os.path.join(TESTS, "fixtures", "add.json"),
    os.path.join(TESTS, "fixtures", "add_error.json"),
]

DANGEROUS = [
    r"\beval\s*\(", r"\bexec\s*\(", r"\bshell_exec\s*\(", r"\bsystem\s*\(",
    r"\bpassthru\s*\(", r"\bproc_open\s*\(", r"\bpopen\s*\(", r"\bunserialize\s*\(",
]


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def php_files(*dirs):
    out = []
    for base in dirs:
        for dirpath, _dirs, files in os.walk(base):
            for name in files:
                if name.endswith(".php"):
                    out.append(os.path.join(dirpath, name))
    return out


def class_methods(path):
    """method name -> 'abstract/interface' or None, from a PHP source file."""
    src = read(path)
    methods = {}
    for match in re.finditer(r"public\s+function\s+(\w+)\s*\(([^)]*)\)", src):
        methods[match.group(1)] = match.group(2).strip()
    return methods


class TestStructure(unittest.TestCase):
    def test_expected_files_exist(self):
        missing = [p for p in EXPECTED_FILES if not os.path.isfile(p)]
        self.assertEqual(missing, [], "missing files: %s" % missing)

    def test_entry_files_guard_direct_access(self):
        for path in [os.path.join(ADDON, "cloudhost247_smm.php"), os.path.join(ADDON, "bootstrap.php"),
                     os.path.join(ADDON, "hooks.php"), os.path.join(SERVER, "cloudhost247_smm.php")]:
            self.assertIn("defined('WHMCS')", read(path), path)

    def test_lib_files_are_namespaced(self):
        for path in php_files(os.path.join(ADDON, "lib")):
            self.assertIn("namespace CloudHost247\\Smm", read(path), path)

    def test_bootstrap_autoload_prefix_matches(self):
        src = read(os.path.join(ADDON, "bootstrap.php"))
        self.assertIn("spl_autoload_register", src)
        self.assertIn("Smm", src)
        self.assertIn("/lib/", src)
        self.assertIn("cloudhost247_core/bootstrap.php", src)

    def test_class_names_match_file_paths(self):
        # class Foo\Bar must live at lib/Bar.php under its namespace
        for path in php_files(os.path.join(ADDON, "lib")):
            src = read(path)
            m = re.search(r"namespace\s+([^;]+);", src)
            ns = m.group(1).replace("\\\\", "\\")
            for cm in re.finditer(r"(?:final\s+)?(?:abstract\s+)?(?:class|interface)\s+(\w+)", src):
                rel = path[len(ADDON) + len("/lib/"):-4].replace("/", "\\")
                expected_ns = "CloudHost247\\Smm\\" + rel.rsplit("\\", 1)[0]
                self.assertEqual(ns, expected_ns, "%s: namespace %s != %s" % (path, ns, expected_ns))

    def test_no_duplicate_methods_per_class(self):
        for path in php_files(os.path.join(ADDON, "lib"), TESTS):
            src = read(path)
            per_class = {}
            current = None
            depth = 0
            for line in src.splitlines():
                cm = re.search(r"(?:class|interface)\s+(\w+)", line)
                if cm and depth == 0:
                    current = cm.group(1)
                depth += line.count("{") - line.count("}")
                fm = re.search(r"function\s+(\w+)\s*\(", line)
                if fm and current:
                    per_class.setdefault((current, fm.group(1)), 0)
                    per_class[(current, fm.group(1))] += 1
                    self.assertEqual(per_class[(current, fm.group(1))], 1,
                                     "%s: duplicate method %s::%s" % (path, current, fm.group(1)))


class TestInterfaces(unittest.TestCase):
    """The contracts must be satisfied by repositories AND test fakes."""

    CONTRACTS = {
        os.path.join(ADDON, "lib", "Contracts", "ProviderFinder.php"):
            [os.path.join(ADDON, "lib", "Repositories", "ProviderRepository.php"), os.path.join(TESTS, "fakes.php")],
        os.path.join(ADDON, "lib", "Contracts", "OrderStore.php"):
            [os.path.join(ADDON, "lib", "Repositories", "OrderRepository.php"), os.path.join(TESTS, "fakes.php")],
        os.path.join(ADDON, "lib", "Contracts", "ApiRecorder.php"):
            [os.path.join(ADDON, "lib", "Repositories", "LogRepository.php"), os.path.join(TESTS, "fakes.php")],
        os.path.join(ADDON, "lib", "Support", "HttpTransport.php"):
            [os.path.join(ADDON, "lib", "Support", "CurlTransport.php"), os.path.join(TESTS, "fakes.php")],
        os.path.join(ADDON, "lib", "Adapters", "ProviderAdapter.php"):
            [os.path.join(ADDON, "lib", "Adapters", "GenericSmmAdapter.php")],
    }

    def test_implementations_satisfy_contracts(self):
        for contract, impls in self.CONTRACTS.items():
            iface_methods = set(class_methods(contract))
            self.assertTrue(iface_methods, "cannot parse contract %s" % contract)
            for impl in impls:
                impl_methods = set(class_methods(impl))
                missing = iface_methods - impl_methods
                self.assertEqual(missing, set(), "%s misses %s (from %s)" % (impl, missing, contract))

    def test_services_only_call_contract_methods(self):
        """Calls on $this->orders / $this->finder / $this->recorder must exist on the constructor's declared type."""
        method_sets = {
            "OrderStore": set(class_methods(os.path.join(ADDON, "lib", "Contracts", "OrderStore.php"))),
            "ProviderFinder": set(class_methods(os.path.join(ADDON, "lib", "Contracts", "ProviderFinder.php"))),
            "ApiRecorder": set(class_methods(os.path.join(ADDON, "lib", "Contracts", "ApiRecorder.php"))),
            "OrderRepository": set(class_methods(os.path.join(ADDON, "lib", "Repositories", "OrderRepository.php"))),
            "ProviderRepository": set(class_methods(os.path.join(ADDON, "lib", "Repositories", "ProviderRepository.php"))),
            "LogRepository": set(class_methods(os.path.join(ADDON, "lib", "Repositories", "LogRepository.php"))),
        }
        services = php_files(os.path.join(ADDON, "lib", "Services")) + [
            os.path.join(TESTS, "run.php")]
        for path in services:
            src = read(path)
            # declared types from the constructor: "OrderRepository $orders = null" etc.
            declared = {}
            for m in re.finditer(r"(\w+)\s+\$(orders|finder|recorder|providers)\b", src):
                declared[m.group(2)] = m.group(1)
            for prop, type_name in declared.items():
                methods = method_sets.get(type_name)
                if methods is None:
                    continue
                for call in re.finditer(r"\$this->%s->(\w+)\(" % prop, src):
                    self.assertIn(call.group(1), methods,
                                  "%s calls %s->%s() which is not on its declared type %s" % (path, prop, call.group(1), type_name))
            # every $this->orders/$this->finder/$this->recorder usage must have a declared type
            for prop in ("orders", "finder", "recorder"):
                if re.search(r"\$this->%s->" % prop, src):
                    self.assertIn(prop, declared, "%s uses $this->%s without a typed constructor dependency" % (path, prop))


class TestSecurity(unittest.TestCase):
    def test_no_dangerous_calls(self):
        for path in php_files(ADDON, SERVER, TESTS) + [CRON]:
            src = read(path)
            for pattern in DANGEROUS:
                self.assertIsNone(re.search(pattern, src), "%s contains %s" % (path, pattern))

    def test_no_raw_capsule_with_variables(self):
        for path in php_files(ADDON, SERVER):
            for m in re.finditer(r"Capsule::raw\s*\(([^;]*)\)", read(path)):
                self.assertNotIn("$", m.group(1), "%s: Capsule::raw with variable" % path)

    def test_admin_controller_has_guards(self):
        src = read(os.path.join(ADDON, "lib", "Services", "AdminController.php"))
        self.assertIn("requireAdmin()", src)
        self.assertIn("requirePostToken()", src)
        self.assertIn("requireCapability(", src)
        # every POST operation block must carry a capability check
        post = src.split("private function handlePost(")[1].split("private function handleGet(")[0]
        blocks = post.split("case '")[1:]
        self.assertGreaterEqual(len(blocks), 16)
        for block in blocks:
            op = block.split("'", 1)[0]
            body = block.split("break;", 1)[0]
            self.assertIn("requireCapability(", body, "operation %s lacks a capability check" % op)

    def test_cron_is_cli_only(self):
        src = read(CRON)
        self.assertIn("PHP_SAPI", src)
        self.assertIn("cli", src)

    def test_transport_hardening(self):
        src = read(os.path.join(ADDON, "lib", "Support", "CurlTransport.php"))
        self.assertIn("CURLOPT_FOLLOWLOCATION => false", src)
        self.assertIn("CURLOPT_SSL_VERIFYPEER => true", src)
        self.assertIn("CURLOPT_SSL_VERIFYHOST => 2", src)
        self.assertIn("CURLOPT_TIMEOUT", src)
        self.assertIn("assertProviderEndpoint", src)

    def test_url_policy_blocks_private_ranges(self):
        src = read(os.path.join(ADDON, "lib", "Support", "UrlPolicy.php"))
        for cidr in ["'10.0.0.0/8'", "'172.16.0.0/12'", "'192.168.0.0/16'", "'127.0.0.0/8'", "'169.254.0.0/16'", "'100.64.0.0/10'"]:
            self.assertIn(cidr, src)
        self.assertIn("'https'", src)

    def test_api_keys_never_stored_or_logged_plaintext(self):
        # providers table has only encrypted + hint columns
        migration = read(os.path.join(ADDON, "migrations", "V100.php"))
        self.assertNotIn("api_key'", migration.replace("api_key_encrypted", "").replace("api_key_hint", ""))
        # adapter sends the key only in the POST body to the validated endpoint
        adapter = read(os.path.join(ADDON, "lib", "Adapters", "GenericSmmAdapter.php"))
        self.assertIn("'key' => $this->apiKey", adapter)
        # log repository routes through the redactor
        logs = read(os.path.join(ADDON, "lib", "Repositories", "LogRepository.php"))
        self.assertIn("Redactor::redactRequest", logs)
        self.assertIn("Redactor::redactResponse", logs)

    def test_provider_form_never_echoes_stored_key(self):
        view = read(os.path.join(ADDON, "lib", "Services", "AdminView.php"))
        self.assertNotIn("api_key_encrypted", view.replace("api_key_hint", ""))

    def test_no_api_calls_in_render_paths(self):
        # AdminController GET branches and the client-area template prep must
        # not instantiate adapters: only POST ops and the cron may.
        src = read(os.path.join(ADDON, "lib", "Services", "AdminController.php"))
        get_block = src.split("private function handleGet(")[1].split("private function saveSettings(")[0]
        self.assertNotIn("AdapterFactory(", get_block.replace("AdapterFactory $factory = null", ""))
        entry = read(os.path.join(ADDON, "cloudhost247_smm.php"))
        clientarea = entry.split("function cloudhost247_smm_clientarea(")[1]
        self.assertNotIn("->submit", clientarea)
        self.assertNotIn("->sync", clientarea)

    def test_client_area_scoped_queries(self):
        repo = read(os.path.join(ADDON, "lib", "Repositories", "OrderRepository.php"))
        self.assertIn("function forClient", repo)
        self.assertIn("'whmcs_client_id', (int) $clientId", repo)
        self.assertIn("function findByWhmcsService", repo)
        # the client service must enforce ownership before actions
        svc = read(os.path.join(ADDON, "lib", "Services", "ClientAreaService.php"))
        self.assertIn("findByWhmcsService", svc)

    def test_idempotency_anchor(self):
        migration = read(os.path.join(ADDON, "migrations", "V100.php"))
        self.assertIn("ch247_smm_order_service_unique", migration)
        repo = read(os.path.join(ADDON, "lib", "Repositories", "OrderRepository.php"))
        self.assertIn("claimForSubmission", repo)
        self.assertIn("'awaiting_submission'", repo)

    def test_secrets_not_in_templates(self):
        for tpl in [os.path.join(ADDON, "templates", "orders.tpl"),
                    os.path.join(SERVER, "templates", "clientarea.tpl")]:
            src = read(tpl)
            for secret in ("api_key", "api_url", "provider_order_id", "$order.raw", "error_message"):
                self.assertNotIn(secret, src, tpl)


class TestTemplates(unittest.TestCase):
    def test_all_smarty_variables_escaped(self):
        for tpl in [os.path.join(ADDON, "templates", "orders.tpl"),
                    os.path.join(SERVER, "templates", "clientarea.tpl")]:
            src = read(tpl)
            for m in re.finditer(r"\{(\$[A-Za-z][\w.\[\]']*(?:\|escape[^}]*)?)\}", src):
                self.assertIn("|escape", m.group(1), "%s unescaped: %s" % (tpl, m.group(1)))

    def test_foreach_variables_escaped(self):
        for tpl in [os.path.join(ADDON, "templates", "orders.tpl"),
                    os.path.join(SERVER, "templates", "clientarea.tpl")]:
            src = read(tpl)
            for m in re.finditer(r"\{\$(order|smmOrder)\.[\w]+[^}]*\}", src):
                self.assertIn("|escape", m.group(0), "unescaped variable in %s: %s" % (tpl, m.group(0)))


class TestMigration(unittest.TestCase):
    def test_guarded_namespaced_non_destructive(self):
        src = read(os.path.join(ADDON, "migrations", "V100.php"))
        creates = re.findall(r"schema\(\)->create\(\s*'([^']+)'", src)
        self.assertEqual(len(creates), 9)
        for table in creates:
            self.assertTrue(table.startswith("mod_cloudhost247_smm_"), table)
        self.assertEqual(src.count("hasTable('mod_cloudhost247_smm_"), 9)
        for bad in ("->drop(", "->dropIfExists(", "->rename("):
            self.assertNotIn(bad, src)
        self.assertNotIn("schema()->table('tbl", src)
        self.assertIn("return '1.0.0'", src)

    def test_version_registered_in_gate(self):
        gate = read(os.path.join(ROOT, "scripts", "validate-migrations.py"))
        self.assertIn("'cloudhost247_smm':['1.0.0']", gate)


class TestProvisioning(unittest.TestCase):
    def test_provisioning_functions_present(self):
        src = read(os.path.join(SERVER, "cloudhost247_smm.php"))
        for fn in ("cloudhost247_smm_ConfigOptions", "cloudhost247_smm_CreateAccount",
                   "cloudhost247_smm_SuspendAccount", "cloudhost247_smm_UnsuspendAccount",
                   "cloudhost247_smm_TerminateAccount", "cloudhost247_smm_ClientArea",
                   "cloudhost247_smm_ClientAreaCustomButtonArray"):
            self.assertIn("function " + fn, src, fn)
        self.assertIn("submitForService", src)

    def test_addon_entry_points(self):
        src = read(os.path.join(ADDON, "cloudhost247_smm.php"))
        for fn in ("cloudhost247_smm_config", "cloudhost247_smm_activate",
                   "cloudhost247_smm_deactivate", "cloudhost247_smm_output",
                   "cloudhost247_smm_clientarea"):
            self.assertIn("function " + fn, src, fn)
        self.assertIn("requirelogin", src)

    def test_hooks_only_cron(self):
        src = read(os.path.join(ADDON, "hooks.php"))
        self.assertIn("add_hook('AfterCronJob'", src)
        hooks = re.findall(r"add_hook\('(\w+)'", src)
        self.assertEqual(hooks, ["AfterCronJob"], "unexpected page-render hooks: %s" % hooks)

    def test_superseded_legacy_module_untouched(self):
        # the old basic module must still exist (superseded, not replaced)
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "modules", "addons", "smmaddon", "smmaddon.php")))


class TestBehaviorSuite(unittest.TestCase):
    def test_run_php_loads_fakes_and_real_libs(self):
        src = read(os.path.join(TESTS, "run.php"))
        self.assertIn("require_once __DIR__ . '/fakes.php'", src)
        self.assertIn("OrderService", src)
        self.assertIn("StatusSyncService", src)
        self.assertIn("ReconciliationService", src)
        self.assertIn("CatalogSync", src)
        self.assertIn("idempotent", src)
        self.assertIn("exit($fail ? 1 : 0)", src)

    def test_fakes_load_after_the_interfaces_they_implement(self):
        """The fakes implement module interfaces; PHP resolves 'implements'
        at declaration time, so every contract file must be required before
        fakes.php (this exact ordering bug broke the first CI run)."""
        src = read(os.path.join(TESTS, "run.php"))
        fakes_pos = src.index("require_once __DIR__ . '/fakes.php'")
        for contract in ("Support/HttpTransport.php", "Contracts/ProviderFinder.php",
                         "Contracts/OrderStore.php", "Contracts/ApiRecorder.php",
                         "Support/UrlPolicy.php"):
            self.assertLess(src.index("require_once $lib . '" + contract + "'"), fakes_pos,
                            "%s must load before fakes.php" % contract)

    def test_fakes_are_test_only(self):
        src = read(os.path.join(TESTS, "fakes.php"))
        self.assertIn("namespace CloudHost247\\Smm\\Test", src)
        # fakes must not be referenced from module code
        for path in php_files(ADDON, SERVER):
            self.assertNotIn("CloudHost247\\Smm\\Test", read(path), path)

    def test_docs_exist(self):
        for doc in ("INSTALLATION.txt", "CAPABILITIES.txt"):
            self.assertTrue(os.path.isfile(os.path.join(ROOT, "docs", "build-notes", "cloudhost247-smm", doc)), doc)
        self.assertTrue(os.path.isfile(os.path.join(ADDON, "README.md")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
