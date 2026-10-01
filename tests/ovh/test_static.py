from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parents[2];ADDON=ROOT/'modules/addons/cloudhost247_ovh';SERVER=ROOT/'modules/servers/cloudhost247_ovh'
class OvhSafetyTests(unittest.TestCase):
 def sources(self):return list(ADDON.rglob('*.php'))+list(SERVER.rglob('*.php'))+[ROOT/'crons/cloudhost247_ovh.php']
 def test_no_wgs_license_dependency(self):
  bad=re.compile(r'CheckLicense|licenseNumtoactivate|WGSModule|modules/addons/soyoustart',re.I)
  for p in self.sources():self.assertIsNone(bad.search(p.read_text()),str(p))
 def test_no_secrets_logged(self):
  for p in self.sources():
   if p.name=='Credentials.php':continue
   self.assertNotRegex(p.read_text(),r'Logger::write\([^;]*(applicationSecret|consumerKey|signature)')
 def test_tls_and_limits(self):
  s=(ADDON/'lib/Api/CurlTransport.php').read_text();self.assertIn('CURLOPT_SSL_VERIFYPEER=>true',s);self.assertIn('CURLOPT_SSL_VERIFYHOST=>2',s);self.assertIn('$received>$maxBytes',s)
 def test_idempotency_and_non_destructive_sync(self):
  p=(ADDON/'lib/Services/Provisioner.php').read_text();self.assertRegex(p,r"hash\('sha256',\s*'provision:'");self.assertIn('idempotency_key',p)
  s=(ADDON/'lib/Services/Synchronizer.php').read_text();self.assertIn("['skipped_count']++",s);self.assertNotIn("table('tblhosting')->update",s)
 def test_admin_security(self):
  s=(ADDON/'lib/Services/AdminController.php').read_text();self.assertIn('requireAdmin()',s);self.assertIn('requirePostToken()',s)
 def test_no_financial_deletes_or_writes(self):
  bad=re.compile(r"table\('(tblinvoices|tblaccounts|tblinvoiceitems)'\).*(update|delete|insert)",re.S)
  for p in self.sources():self.assertIsNone(bad.search(p.read_text()),str(p))
 def test_cli_cron(self):self.assertIn("PHP_SAPI!=='cli'",(ROOT/'crons/cloudhost247_ovh.php').read_text())
 def test_ambiguous_mutations_stop_for_reconciliation(self):
  p=(ADDON/'lib/Services/Provisioner.php').read_text()
  self.assertIn("'reconciliation_required'",p);self.assertIn("'remote_mutation'",p);self.assertIn('beforeMutation',p)
 def test_order_binding_and_duplicate_protection(self):
  p=(ADDON/'lib/Reconciliation/OrderPoller.php').read_text()
  self.assertIn("'/status'",p);self.assertIn("'/details'",p);self.assertIn("already bound elsewhere",p);self.assertIn("'intervention_required'",p)
 def test_existing_link_requires_confirmation_and_audit(self):
  p=(ADDON/'lib/Reconciliation/ExistingServiceLinker.php').read_text()
  self.assertIn('Explicit link confirmation',p);self.assertIn("'service.link'",p);self.assertIn('already linked to another',p)
 def test_price_apply_is_explicit_and_invoice_safe(self):
  p=(ADDON/'lib/Pricing/PricingService.php').read_text()
  self.assertIn('Explicit pricing confirmation',p);self.assertIn("table('tblpricing')",p);self.assertNotIn("table('tblinvoices')",p)
 def test_reverse_dns_requires_confirmation(self):
  p=(ADDON/'lib/Services/ReverseDnsManager.php').read_text();self.assertIn('Explicit reverse-DNS confirmation',p);self.assertIn('FILTER_VALIDATE_DOMAIN',p)
 def test_safe_order_discovery_requires_unique_cart_match(self):
  p=(ADDON/'lib/Reconciliation/OrderDiscovery.php').read_text()
  self.assertIn('count($matches)!==1',p);self.assertIn('hash_equals',p);self.assertIn("'reconciliation_required'",p)
 def test_option_mapping_is_exact_and_confirmed(self):
  p=(ADDON/'lib/Catalog/ConfigurableOptionMapper.php').read_text()
  self.assertIn('Explicit configurable-option mapping confirmation',p);self.assertIn('$allowed=false',p);self.assertIn('exact discovered match',p)
 def test_capability_guards_cover_admin_mutations(self):
  for p in [ROOT/'modules/addons/cloudhost247_theme/lib/AdminController.php',ROOT/'modules/addons/cloudhost247_currency/lib/Services/AdminController.php',ADDON/'lib/Services/AdminController.php']:
   self.assertIn('requireCapability(',p.read_text(),str(p))
 def test_advanced_operations_are_guarded(self):
  a=(ADDON/'lib/Services/AdvancedOperations.php').read_text();c=(ADDON/'lib/Services/AdminController.php').read_text()
  self.assertIn('Explicit confirmation is required',a);self.assertIn('Type the exact OVH service name',a);self.assertIn('hash_equals',a)
  self.assertIn("'advanced_run','rdns_set','rdns_delete'",c);self.assertRegex(c,r"\$capability = in_array\(\$op,array\([^)]*'advanced_run'")
  self.assertNotIn('shell_exec',a);self.assertNotIn('exec(',a)
  m=(ADDON/'lib/Services/ServiceManager.php').read_text();self.assertIn('function performSub',m);self.assertIn('reconciliation_required',m)
 def test_advanced_operations_not_exposed_to_customers(self):
  s=(SERVER/'cloudhost247_ovh.php').read_text();self.assertNotIn('AdvancedOperations',s)
if __name__=='__main__':unittest.main()
