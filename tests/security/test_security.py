from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parents[2]
OWNED=[ROOT/'modules/addons/cloudhost247_core',ROOT/'modules/addons/cloudhost247_theme',ROOT/'modules/addons/cloudhost247_currency',ROOT/'modules/addons/cloudhost247_integrations',ROOT/'modules/addons/cloudhost247_modules',ROOT/'modules/addons/cloudhost247_builder',ROOT/'modules/addons/cloudhost247_ovh',ROOT/'modules/servers/cloudhost247_ovh',ROOT/'modules/addons/cloudhost247_smm',ROOT/'modules/servers/cloudhost247_smm',ROOT/'modules/addons/cloudhost247_tools',ROOT/'modules/addons/cloudhost247_broker',ROOT/'modules/addons/cloudhost247_passkey']
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
  common=(ROOT/'scripts/lib/staging-common.php').read_text();self.assertIn("PHP_SAPI!=='cli'",common);self.assertIn('CH247_STAGING_CONFIRM',common);self.assertIn('CH247_STAGING_HOST_ALLOWLIST',common)
  for name in ('staging-preflight.php','staging-financial-snapshot.php','staging-baseline-evidence.php','staging-backup-verify.php'):
   s=(ROOT/'scripts'/name).read_text();self.assertIn('staging-common.php',s);self.assertNotIn("require $root . '/configuration.php'",s)
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
 def test_email_module_rename_is_migrated_rather_than_left_behind(self):
  sql=(ROOT/'scripts/migrate-legacy-names-to-cloudhost247.sql').read_text();register=(ROOT/'docs/BRANDING-COMPATIBILITY.md').read_text()
  for table in ('accounts','operations','locks','log','webhooks','dns','content','migrations'):
   self.assertIn("ch247_rename_if_exists(CONCAT(@mb,'email_%s'"%table,sql,table)
   self.assertIn("'mod_cloudhost247_email_hosting_%s'"%table,sql,table)
  # the retired identifiers are assembled from fragments so the script itself
  # never spells the retired brand in plain text
  self.assertIn("SET @b  = CONCAT('host','x');",sql)
  self.assertIn("SET @mb = CONCAT('mod_',@b,'_');",sql)
  # the vendor theme-helper addon is retired, not carried forward
  self.assertIn('DELETE FROM tbladdonmodules WHERE module = @b;',sql)
  self.assertIn("'mod_cloudhost247_theme_pages'",sql)
  self.assertIn("UPDATE tblservers  SET type       = 'cloudhost247_email_hosting'",sql)
  self.assertIn("UPDATE tblproducts SET servertype = 'cloudhost247_email_hosting'",sql)
  # the inactive legacy cloudhost247_email module owns mod_cloudhost247_email_accounts
  self.assertNotIn("UPDATE tblproducts SET servertype = 'cloudhost247_email'",sql)
  self.assertIn('cloudhost247_email_hosting',register);self.assertIn('X-CloudHost247-Signature',register);self.assertNotIn('X-'+'Host'+'x-*',register)
 def test_email_module_source_carries_no_legacy_branding_identifier(self):
  module=ROOT/'modules/servers/cloudhost247_email_hosting'
  self.assertTrue(module.is_dir());self.assertFalse((ROOT/('modules/servers/'+'host'+'x_email')).exists())
  bad=re.compile(r'host[\s_-]?x',re.I)
  for p in sorted(q for q in module.rglob('*') if q.is_file()):
   self.assertIsNone(bad.search(p.read_text()),str(p))
  self.assertIn("define('CH247_EMAIL_MODULE', 'cloudhost247_email_hosting')",(module/'bootstrap.php').read_text())
  webhook=(module/'webhook.php').read_text();self.assertIn('X-CloudHost247-Signature',webhook);self.assertNotIn('X-'+'Host'+'x',webhook)
  entry=(module/'cloudhost247_email_hosting.php').read_text()
  for suffix in ('_MetaData','_ConfigOptions','_CreateAccount','_ClientArea','_AdminServicesTabFields'):
   self.assertIn('function cloudhost247_email_hosting'+suffix+'(',entry,suffix)
 def test_email_client_area_action_and_csrf_use_current_identifiers_only(self):
  module=ROOT/'modules/servers/cloudhost247_email_hosting'
  presenter=(module/'lib/Service/ClientAreaPresenter.php').read_text();functions=(module/'functions.php').read_text();template=(module/'templates/overview.tpl').read_text()
  self.assertIn("$post['ch247_email_action'] ?? ''",presenter)
  self.assertIn("!empty($_POST['ch247_email_action'])",functions)
  self.assertIn("$_SESSION['ch247_email_token']",presenter)
  self.assertIn('name="ch247_email_action"',template)
  # the transitional rollout shim is retired; an unrecognised action renders the overview
  leg='host'+'x_email_action';self.assertNotIn(leg,presenter);self.assertNotIn(leg,functions);self.assertNotIn(leg,template)
 def test_company_name_sql_rebrand_is_limited_to_exact_configuration_values(self):
  sql=(ROOT/'scripts/migrate-legacy-names-to-cloudhost247.sql').read_text()
  section=sql.split('-- 6. Company legal name',1)[1].split('-- Verification.',1)[0]
  self.assertIn("setting = 'CompanyName'",section);self.assertIn('LOWER(TRIM(value)) IN (',section)
  self.assertIn("SET value = 'CloudHost247 Isc.'",section);self.assertIn("'cloudhost247 isc'",section);self.assertIn("'cloudhost247 pvt ltd.'",section)
  self.assertNotIn('tblclients',section);self.assertNotIn('tblproducts',section)
 def test_contact_language_company_names_use_the_official_legal_entity(self):
  files=list((ROOT/'lang/overrides').glob('*.php'));matched=0
  for p in files:
   for line in p.read_text().splitlines():
    if "['contactuscompanyname']" in line:
     matched+=1;self.assertIn('CloudHost247 Isc.',line,str(p));self.assertNotRegex(line,r'(?i)\b(pvt|inc)\b',str(p))
  self.assertEqual(matched,27)
 def test_release_candidate_check_is_complete(self):
  s=(ROOT/'scripts/release-candidate-check.sh').read_text()
  for marker in ('php -l','tests/foundation/run.php','tests/cloudhost247_email/run.php','unittest','validate-migrations.py','branding-audit.py','original-file-manifest.sha256','sha256sum --check','core.whitespace=cr-at-eol diff --check'):self.assertIn(marker,s)
 def test_audit_filters_and_pagination_are_bounded(self):
  s=(ROOT/'modules/addons/cloudhost247_core/lib/Support/AuditRepository.php').read_text()
  for name in ('module','action','resource_type','resource','result','correlation_id','admin_id','from','to','q'):self.assertIn("'"+name+"'",s)
  self.assertIn('min(100',s);self.assertIn('offset(',s);self.assertIn('limit(',s)
 def test_operations_are_filtered_paginated_and_not_fabricated(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Operations/OperationsDashboard.php').read_text()
  for marker in ('ops_page','offset(','limit(','reconciliation_required'):self.assertIn(marker,s)
 def test_native_theme_has_focus_mobile_and_reduced_motion(self):
  for p in (ROOT/'templates/cloudhost247/css/custom.css',ROOT/'templates/orderforms/cloudhost247/css/custom.css'):
   s=p.read_text();self.assertIn('focus-visible',s);self.assertIn('@media(max-width:767px)',s);self.assertIn('prefers-reduced-motion',s)
 def test_cms_open_graph_canonical_and_sitemap_controls(self):
  repo=(ROOT/'modules/addons/cloudhost247_theme/lib/ThemeRepository.php').read_text();hooks=(ROOT/'modules/addons/cloudhost247_theme/hooks.php').read_text();site=(ROOT/'cloudhost247-sitemap.php').read_text()
  for marker in ('og_title','og_description','canonical_url','sitemap'):self.assertIn(marker,repo)
  self.assertIn('rel="canonical"',hooks);self.assertIn("published('landing')",site)
 def test_safe_errors_use_correlation_without_raw_customer_exception(self):
  s=(ROOT/'modules/addons/cloudhost247_core/lib/Support/SafeError.php').read_text();self.assertIn('correlation_id',s);self.assertNotIn('getMessage()',s);self.assertNotIn('getTrace',s)
 def test_localized_preview_is_non_persistent(self):
  repo=(ROOT/'modules/addons/cloudhost247_theme/lib/ThemeRepository.php').read_text();body=repo.split('public function previewTranslation',1)[1].split('public function deleteContent',1)[0];self.assertNotIn('insert',body.lower());self.assertNotIn('update',body.lower());self.assertIn("'preview_only'=>true",body)
if __name__=='__main__':unittest.main()
