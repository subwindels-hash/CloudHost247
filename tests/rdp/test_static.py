from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'modules/servers/RDP'
DOC=ROOT/'docs/independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md'
RDP_ARCHIVE_SHA256='89bf89129458032ffe9efff4000f5c695d0534cc05e785b3a2602ec9784c5aa2'
# Files the vendor archive contributed; the rebuild's own files are listed separately below.
VENDOR_FILES=('RDP.php','hooks.php','lib/Helper.php','lib/index.php','assets/index.php','assets/css/index.php','assets/js/index.php','assets/css/admin-style.css','assets/css/client-style.css','assets/js/admin-script.js','assets/js/client-script.js','assets/images/netlink.webp','templates/error.tpl','templates/overview.tpl')
REBUILD_FILES=('bootstrap.php','lib/Api/ConfigResolver.php','lib/Api/ProviderClient.php','lib/Api/ProviderException.php','lib/Contracts/Ledger.php','lib/Contracts/Provider.php','lib/Operations/DatabaseLedger.php','lib/Operations/LifecycleService.php','migrations/V100.php','assets/css/client.css')
def entry():return (BASE/'RDP.php').read_text()
def helper():return (BASE/'lib/Helper.php').read_text()
def vendor_active():return (BASE/'lib/Helper.php').is_file() and 'rdparena.com' in helper()
class SecureRdpStaticTests(unittest.TestCase):
 """The RDP module path holds the vendor archive's code as of 2026-10-02.

 The owner directed that `RDP.zip` be extracted over `modules/servers/RDP/` and the
 archive deleted. That replaced the independent secure rebuild's entry point and both
 templates with the vendor RDP Arena module and added its helper, hook, assets and
 directory guards; the rebuild's ten files survive and are inert, because the vendor
 entry point requires none of them.

 This suite pins BOTH halves. For the vendor module it pins what the code actually
 does — including every property the rebuild forbade — so that none of it is invisible
 to a reader or to a future audit: pinning a risk is not endorsing it, and deleting the
 assertion would only hide it. For the rebuild it keeps the guarantees that its
 surviving files still hold, so restoring the entry point is verifiable rather than
 hopeful. Where a guarantee belonged to a file the extraction overwrote, the test skips
 with the exact restore command instead of quietly passing.
 """
 # ---------------------------------------------------------------- active vendor module
 def test_the_active_entry_point_is_the_vendor_copy(self):
  self.assertTrue(vendor_active(),'expected the vendor helper: if the rebuild was restored, this suite must be updated with it')
  self.assertIn('https://www.rdparena.com/payments/resellerapi.php',helper())
  self.assertIn('namespace WHMCS\\Module\\Server\\RDP;',helper())
  self.assertIn('new Helper($params)',entry())
  self.assertNotIn('ConfigResolver::resolve',entry())
  for callback in ('RDP_MetaData','RDP_ConfigOptions','RDP_CreateAccount','RDP_SuspendAccount','RDP_UnsuspendAccount','RDP_TerminateAccount','RDP_Renew','RDP_ClientArea','RDP_AdminServicesTabFields','RDP_TestConnection'):
   self.assertIn('function '+callback,entry(),callback)
  for name in VENDOR_FILES: self.assertTrue((BASE/name).is_file(),name)
 def test_vendor_risks_are_pinned_not_hidden(self):
  e,h,t=entry(),helper(),(BASE/'templates/overview.tpl').read_text()
  # credentials: serialized into email customvars, emailed in clear text through a template
  # the module inserts itself, and written to a WHMCS core table as a direct Capsule update.
  self.assertIn('base64_encode(serialize(',e)
  self.assertIn('Welcome RDP Credentials Email',e)
  self.assertIn('Capsule::table("tblhosting")',e)
  self.assertIn('"password" => base64_decode(',e)
  self.assertIn("Capsule::table('tblcustomfields')",h)
  self.assertIn("Capsule::table('tblcustomfieldsvalues')",h)
  self.assertIn("Capsule::table('tblemailtemplates')",h)
  # transport: one hard-coded endpoint, redirects followed, no TLS verification option set,
  # no response cap, and a timeout of 10000 seconds where the comment claims seconds.
  self.assertIn('CURLOPT_FOLLOWLOCATION, 1',h)
  self.assertNotIn('CURLOPT_SSL_VERIFYPEER',h)
  self.assertNotIn('CURLOPT_SSL_VERIFYHOST',h)
  self.assertIn('CURLOPT_TIMEOUT, 10000',h)
  # client area: the password reaches the DOM unescaped, in an attribute the toggle reads.
  self.assertIn('data-password="{$encodedPassword}"',t)
  self.assertEqual(0,t.count('|escape'))
  self.assertIn('passwordField',(BASE/'assets/js/client-script.js').read_text())
  # lifecycle: suspend, unsuspend and terminate report success without calling the provider.
  for callback in ('RDP_SuspendAccount','RDP_UnsuspendAccount','RDP_TerminateAccount'):
   body=e[e.index('function '+callback):]
   body=body[:body.index('\n}')]
   self.assertNotIn('$helper',body,callback+' is expected to be a no-op; if it now calls the provider, update this pin')
   self.assertIn('return true',body,callback)
 def test_vendor_php8_only_named_arguments_are_patched(self):
  # `RDP_ConfigOptions` used the PHP 8.0 named argument `trim(string: $stock->{'name '})`.
  # On PHP 7.4 - the version scripts/release-candidate-check.sh lints and the version the
  # build notes name as a target - that is a parse error, so WHMCS hit a fatal include and
  # the module could not load at all. It was recorded rather than patched while the gate was
  # unrunnable; the owner then instructed that it be fixed, and it now is: exactly eight
  # bytes (`string: `) were removed from RDP.php and nothing else changed.
  #
  # This asserts the fixed state, so the guard is not vacuous in either direction: it fails
  # if the PHP-8-only syntax comes back (a restore from the archive would reintroduce it),
  # and it fails if the doc stops recording that the file is a reviewed deviation.
  named=re.findall(r"\b\w+\(\s*[A-Za-z_]\w*\s*:",entry())
  self.assertEqual([],named,'PHP 8-only named arguments are a parse error on PHP 7.4 and must not reappear in the vendor entry point')
  doc=DOC.read_text()
  self.assertIn('PATCHED 2026-10-03',doc,'the deliberate deviation from the byte-for-byte archive must stay recorded')
  self.assertIn('PHP 8',doc);self.assertIn('7.4',doc)
  self.assertIn('parse error',doc)
  # The patched call must still be the vendor call: same object, same property name.
  self.assertIn("trim($stock->{'name '})",entry())
 def test_the_archive_was_extracted_and_removed(self):
  self.assertFalse((ROOT/'RDP.zip').exists())
  if not (ROOT/'.gitignore').is_file():
   self.skipTest('repository only: the exported deployment package ships no .gitignore')
  self.assertIn('*.zip',(ROOT/'.gitignore').read_text())
  self.assertIn(RDP_ARCHIVE_SHA256,DOC.read_text(),'the archive hash must stay written down after the archive is gone')
  # byte-for-byte fidelity against the archive itself is checked wherever the archive is
  # still held: tests/security/test_archive_integration.py
 # ------------------------------------------------------------------- inert rebuild
 def test_rebuild_files_survive_the_extraction(self):
  for name in REBUILD_FILES: self.assertTrue((BASE/name).is_file(),name)
  self.assertIn('IntegrationManager::optionalCredentials',(BASE/'lib/Api/ConfigResolver.php').read_text())
 def test_rebuild_transport_security_boundaries(self):
  s=(BASE/'lib/Api/ProviderClient.php').read_text();self.assertIn("$parts['scheme']??''",s);self.assertIn('CH247_RDP_ALLOWED_HOSTS',s);self.assertIn('CURLOPT_FOLLOWLOCATION=>false',s);self.assertIn('CURLOPT_CONNECTTIMEOUT=>5',s);self.assertIn('CURLOPT_TIMEOUT=>20',s);self.assertIn('CURLOPT_SSL_VERIFYPEER=>true',s);self.assertIn('CURLOPT_SSL_VERIFYHOST=>2',s);self.assertIn('1048576',s)
 def test_rebuild_mutations_use_idempotency_and_reconciliation(self):
  s=(BASE/'lib/Operations/LifecycleService.php').read_text();self.assertIn("hash('sha256'",s);self.assertIn('reconciliation_required',s);self.assertIn('intervention_required',s);self.assertNotIn('sleep(',s)
 def test_rebuild_ledger_never_has_secret_columns(self):
  s=(BASE/'migrations/V100.php').read_text().lower();self.assertNotRegex(s,r"string\('(password|token|secret|credential)");self.assertIn('idempotency_key',s);self.assertIn('provider_operation_id',s)
 def test_rebuild_never_writes_a_whmcs_core_table(self):
  for name in REBUILD_FILES:
   if name.endswith('.php'):
    self.assertIsNone(re.search(r"Capsule::table\(['\"]tbl",(BASE/name).read_text()),name)
 def test_client_ownership_and_template_escaping_belong_to_the_rebuild_entry_point(self):
  if vendor_active():
   self.skipTest('the vendor entry point is active: it relies on WHMCS routing for ownership and escapes nothing in overview.tpl. These assertions apply again only after the vendor entry point and templates are replaced by the rebuild - see tests/security/test_archive_integration.py, which pins both states.')
  s=entry();self.assertIn("$_SESSION['uid']",s);self.assertIn("$uid!==(int)$p['userid']",s);self.assertIn("$b->client_id!==$uid",s)
  t=(BASE/'templates/overview.tpl').read_text();self.assertGreaterEqual(t.count('|escape'),7);self.assertNotIn('nofilter',t)
if __name__=='__main__':unittest.main()
