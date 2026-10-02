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
  # The exactness rule lives in the pure matcher and is proved by the run suite;
  # here the wiring is asserted: confirmation is required, the rule is consulted,
  # and the provenance flag is derived rather than trusted from the request.
  p=(ADDON/'lib/Catalog/ConfigurableOptionMapper.php').read_text()
  self.assertIn('Explicit configurable-option mapping confirmation',p)
  self.assertIn('matcher->admits',p)
  self.assertIn('exact discovered match',p)
  self.assertIn('$verified = $whmcsSuboptionId',p)
  self.assertIn('valueWasProven',p)
  matcher=(ADDON/'lib/Catalog/DiscoveredOptionMatcher.php').read_text()
  self.assertIn('$whmcsSuboptionId',matcher)
  self.assertIn('unambiguous',matcher)
  extractor=(ADDON/'lib/Normalization/OptionValueExtractor.php').read_text()
  self.assertIn("'unverified'",extractor)

 def test_discovery_and_specification_ui_is_read_only_and_explicit(self):
  # The admin screen surfaces the directory, the prefill and the value-level
  # mapping, and none of those paths writes without the confirmation checkbox.
  ui=(ADDON/'cloudhost247_ovh.php').read_text()
  self.assertIn("value=\"link_directory\"",ui)
  self.assertIn("value=\"product_prefill\"",ui)
  self.assertIn("value=\"intervention_reconcile\"",ui)
  self.assertIn('Confirm link',ui)
  self.assertIn('Replace existing binding',ui)
  self.assertIn('not verified',ui)
  controller=(ADDON/'lib/Services/AdminController.php').read_text()
  self.assertIn("'link_directory'",controller)
  self.assertIn("'intervention_reconcile'",controller)
  self.assertIn("'product_prefill'",controller)
  # Reads stay on operations.run; the reconciling write joins the apply set.
  self.assertIn("in_array($op,array('price_apply','link_confirm','intervention_reconcile'",controller)
  linker=(ADDON/'lib/Reconciliation/ExistingServiceLinker.php').read_text()
  self.assertIn('Confirm the replacement explicitly to rebind it.',linker)
  self.assertIn('service.relink',linker)
  self.assertIn('service.reconcile',linker)
  self.assertIn('intervention_required',linker)

 def test_new_migrations_are_additive_and_registered(self):
  addon=(ADDON/'cloudhost247_ovh.php').read_text()
  self.assertIn('V170.php',addon);self.assertIn('V180.php',addon)
  self.assertIn('OptionVerificationMigration',addon);self.assertIn('ProductSpecificationEvidenceMigration',addon)
  for name in ('V170.php','V180.php'):
   text=(ADDON/'migrations'/name).read_text()
   self.assertIn('hasColumn',text)     # additive: the column is added only if absent
   self.assertNotIn('dropColumn',text)
   self.assertNotIn('dropTable',text)
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
 def test_address_scoped_actions_verify_ownership(self):
  m=(ADDON/'lib/Services/ServiceManager.php').read_text()
  self.assertIn('function boundAddress',m);self.assertIn('filter_var($ip,FILTER_VALIDATE_IP)',m)
  self.assertIn("not one OVH reports for this service",m)
  self.assertIn('function ipSub',m);self.assertIn('function performIpSub',m)
  # The allowlisted sub-path carries the dotted IPv4 of the firewall entry, and never traverses.
  self.assertIn('private function safeSub($suffix,$context)',m)
  self.assertIn("strpos($s,'..')!==false",m)
  self.assertIn("[A-Za-z0-9._/-]",m)
  a=(ADDON/'lib/Services/AdvancedOperations.php').read_text()
  # An address is only accepted through the declared field, and the path is built here.
  self.assertIn("'address' => true",a);self.assertIn("private function address(array $in)",a)
  self.assertIn("'/ip/'.rawurlencode($address)",m)
  # No request path may come from a raw posted value.
  self.assertNotIn("_POST['path']",a);self.assertNotIn("$in['path']",a)
 def test_catalog_families_may_be_lists_and_firewall_is_destructive(self):
  a=(ADDON/'lib/Services/AdvancedOperations.php').read_text()
  self.assertIn("array('vps', 'dedicated')",a)
  self.assertIn("in_array($identity['family'], (array) $catalog[$action]['family'], true)",a)
  c=(ADDON/'lib/Services/AdvancedOperations.php').read_text()
  for action in ('firewall_status','firewall_rules','firewall_rule_add','firewall_rule_delete'):
   self.assertIn("'"+action+"'",c,action)
  # There is no /firewall/option route on the published surface: the module must not invent one.
  self.assertNotIn('firewall_option',c)
  self.assertNotIn('/firewall/option',c)
  # Enums and shapes come from OVH's own firewall-rule schema.
  self.assertIn("const FIREWALL_ACTIONS = array('permit', 'deny')",c)
  self.assertIn("const FIREWALL_PROTOCOLS = array('ah', 'esp', 'gre', 'icmp', 'ipv4', 'tcp', 'udp')",c)
  self.assertIn('MAX_RULE_SEQUENCE = 19',c)
  self.assertIn("private function firewallAddress(array $in)",c)
  self.assertIn('FILTER_FLAG_IPV4',c)
  self.assertIn('private function portNumber($value, $label)',c)
  self.assertNotIn('ipv6-icmp',c)
  self.assertNotIn('portSpec',c)
  self.assertIn("'firewall_rule_add'     => array('family' => array('vps', 'dedicated'), 'kind' => 'write', 'label' => 'Add a firewall rule (changes network reachability)', 'destructive' => true",c)
  self.assertIn("'firewall_rule_delete'  => array('family' => array('vps', 'dedicated'), 'kind' => 'write', 'label' => 'Delete a firewall rule (changes network reachability)', 'destructive' => true",c)
  for action in ('dedicated_interventions','dedicated_intervention','dedicated_boot_options'):
   self.assertIn("'"+action+"'",c,action)
  self.assertIn('BOOT_TYPES',c);self.assertIn("array('harddisk', 'rescue', 'netboot')",c)
  self.assertIn('fillPath',c)
 def test_admin_form_carries_the_new_advanced_inputs(self):
  view=(ADDON/'cloudhost247_ovh.php').read_text()
  for field in ('name="intervention_id"','name="ip"','name="firewall"','name="sequence"','name="destination_port"','name="boot_type"','name="kernel"'):
   self.assertIn(field,view,field)
  # The rule action select must post `action`, and the read button must pass the form through.
  self.assertIn('<select name="action" class="form-control">',view)
  c=(ADDON/'lib/Services/AdminController.php').read_text()
  self.assertIn("advanced_action'],$_POST)",c)
  self.assertIn('->read(',c)
 def test_backup_restore_is_not_invented(self):
  a=(ADDON/'lib/Services/AdvancedOperations.php').read_text()
  # No restore route may be invented: only the snapshot revert that OVH documents.
  self.assertIn("'vps_snapshot_revert'",a)
  for marker in ('automatedBackup/restore','backupFTP/requestRestore','restoreBackup'):
   self.assertNotIn(marker,a,marker)
if __name__=='__main__':unittest.main()
