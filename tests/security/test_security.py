from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parents[2]
OWNED=[ROOT/'modules/addons/cloudhost247_core',ROOT/'modules/addons/cloudhost247_theme',ROOT/'modules/addons/cloudhost247_currency',ROOT/'modules/addons/cloudhost247_ovh',ROOT/'modules/servers/cloudhost247_ovh']
class RebuildSecurityReview(unittest.TestCase):
 def sources(self):
  return [p for d in OWNED for p in d.rglob('*') if p.suffix in ('.php','.tpl')]
 def test_no_command_execution_or_unsafe_deserialization(self):
  bad=re.compile(r'\b(eval|exec|shell_exec|system|passthru|proc_open|popen|unserialize)\s*\(',re.I)
  for p in self.sources():self.assertIsNone(bad.search(p.read_text()),str(p))
 def test_no_dynamic_sql_fragments(self):
  bad=re.compile(r'(Capsule::raw|DB::statement)\s*\([^)]*\.\s*\$',re.I)
  for p in self.sources():self.assertIsNone(bad.search(p.read_text()),str(p))
 def test_admin_controllers_auth_and_csrf(self):
  for p in ROOT.glob('modules/addons/cloudhost247_*/lib/**/AdminController.php'):
   s=p.read_text();self.assertIn('requireAdmin()',s,str(p));self.assertIn('requirePostToken()',s,str(p))
 def test_crons_are_cli_only(self):
  for p in (ROOT/'crons').glob('cloudhost247_*.php'):self.assertIn("PHP_SAPI",p.read_text(),str(p))
 def test_no_embedded_private_credentials(self):
  bad=re.compile(r'-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}')
  for p in self.sources():self.assertIsNone(bad.search(p.read_text()),str(p))
 def test_api_ssrf_boundary(self):
  endpoint=(ROOT/'modules/addons/cloudhost247_ovh/lib/Api/Endpoint.php').read_text();self.assertIn('private static $regions',endpoint);self.assertNotIn('api_endpoint)',(ROOT/'modules/addons/cloudhost247_ovh/lib/Api/Client.php').read_text())
 def test_staging_scripts_are_cli_and_confirmation_gated(self):
  for name in ('staging-preflight.php','staging-financial-snapshot.php'):
   s=(ROOT/'scripts'/name).read_text();self.assertIn("PHP_SAPI !== 'cli'",s);self.assertIn('CH247_STAGING_CONFIRM',s);self.assertNotIn('configuration.php',s)
 def test_financial_snapshot_outputs_hashes_not_rows(self):
  s=(ROOT/'scripts/staging-financial-snapshot.php').read_text();self.assertIn("hash_init('sha256')",s);self.assertIn("'sha256'=>hash_final",s);self.assertNotIn("'records'=>",s)
 def test_versioned_gap_migrations_are_namespaced(self):
  for p in [ROOT/'modules/addons/cloudhost247_theme/migrations/V110.php',ROOT/'modules/addons/cloudhost247_ovh/migrations/V130.php']:
   text=p.read_text();self.assertNotIn('drop',text.lower());self.assertRegex(text,r"create\('mod_cloudhost247_")
 def test_management_migrations_are_ordered_additive_and_namespaced(self):
  files=[ROOT/'modules/addons/cloudhost247_ovh/migrations'/f'V{v}.php' for v in (100,110,120,130,140,150)]
  self.assertTrue(all(p.exists() for p in files))
  for p in files:
   s=p.read_text().lower();self.assertNotIn('drop',s);self.assertNotIn("schema()->table('tbl",s)
 def test_consequential_management_writes_are_confirmed_and_audited(self):
  pricing=(ROOT/'modules/addons/cloudhost247_ovh/lib/Pricing/PricingService.php').read_text()
  products=(ROOT/'modules/addons/cloudhost247_ovh/lib/Products/HostingProductManager.php').read_text()
  currency=(ROOT/'modules/addons/cloudhost247_currency/lib/Services/AdminController.php').read_text()
  for s in (pricing,products,currency):self.assertIn('confirm',s.lower());self.assertIn('AuditLogger',s)
 def test_audit_search_is_bounded_and_secret_redaction_is_central(self):
  repo=(ROOT/'modules/addons/cloudhost247_core/lib/Support/AuditRepository.php').read_text();logger=(ROOT/'modules/addons/cloudhost247_core/lib/Support/AuditLogger.php').read_text()
  self.assertIn('min(100',repo);self.assertIn('SecretPolicy::redact',logger)
 def test_reconciliation_never_blindly_retries(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Operations/OperationsDashboard.php').read_text();self.assertIn('never repeat the mutation',s);self.assertNotIn("->post(",s)
if __name__=='__main__':unittest.main()
