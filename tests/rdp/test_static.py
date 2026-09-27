from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'modules/servers/RDP'
class SecureRdpStaticTests(unittest.TestCase):
 def test_no_archive_source_copied(self):
  module=(BASE/'RDP.php').read_text();self.assertNotIn('rdparena.com',module);self.assertNotIn('Welcome RDP Credentials',module);self.assertNotIn('base64_',module);self.assertNotIn('serialize(',module)
 def test_no_secret_exposure_in_templates_or_assets(self):
  for p in list((BASE/'templates').glob('*'))+list((BASE/'assets').rglob('*')):
   if p.is_file():
    s=p.read_text(errors='ignore').lower();self.assertNotIn('passwordfield',s);self.assertNotIn('data-password',s);self.assertNotIn('encodedpassword',s)
 def test_transport_security_boundaries(self):
  s=(BASE/'lib/Api/ProviderClient.php').read_text();self.assertIn("$parts['scheme']??''",s);self.assertIn('CH247_RDP_ALLOWED_HOSTS',s);self.assertIn('CURLOPT_FOLLOWLOCATION=>false',s);self.assertIn('CURLOPT_CONNECTTIMEOUT=>5',s);self.assertIn('CURLOPT_TIMEOUT=>20',s);self.assertIn('1048576',s)
 def test_client_ownership_is_enforced(self):
  s=(BASE/'RDP.php').read_text();self.assertIn("$_SESSION['uid']",s);self.assertIn("$uid!==(int)$p['userid']",s);self.assertIn("$b->client_id!==$uid",s)
 def test_mutations_use_idempotency_and_reconciliation(self):
  s=(BASE/'lib/Operations/LifecycleService.php').read_text();self.assertIn("hash('sha256'",s);self.assertIn('reconciliation_required',s);self.assertIn('intervention_required',s);self.assertNotIn('sleep(',s)
 def test_ledger_never_has_secret_columns(self):
  s=(BASE/'migrations/V100.php').read_text().lower();self.assertNotRegex(s,r"string\('(password|token|secret|credential)");self.assertIn('idempotency_key',s);self.assertIn('provider_operation_id',s)
 def test_no_direct_whmcs_core_writes(self):
  for p in BASE.rglob('*.php'):
   s=p.read_text();self.assertIsNone(re.search(r"Capsule::table\(['\"]tbl",s),str(p))
 def test_templates_escape_customer_values(self):
  s=(BASE/'templates/overview.tpl').read_text();self.assertGreaterEqual(s.count('|escape'),7);self.assertNotIn('nofilter',s)
if __name__=='__main__':unittest.main()
