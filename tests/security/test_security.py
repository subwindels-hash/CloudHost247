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
if __name__=='__main__':unittest.main()
