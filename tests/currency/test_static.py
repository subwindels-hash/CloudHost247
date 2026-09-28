from pathlib import Path
import re, unittest
ROOT=Path(__file__).resolve().parents[2]
class CurrencySafetyTests(unittest.TestCase):
 def files(self): return list((ROOT/'modules/addons/cloudhost247_currency').rglob('*.php'))+[ROOT/'crons/cloudhost247_currency.php']
 def test_no_vendor_dependency(self):
  bad=re.compile(r'xtreme_currency_rates|license_verify|ioncube_callback',re.I)
  for p in self.files(): self.assertIsNone(bad.search(p.read_text()),str(p))
 def test_no_historical_financial_writes(self):
  forbidden=re.compile(r"(?:update|delete).*?(?:tblinvoices|tblaccounts|tblinvoiceitems|tblpricing)",re.I|re.S)
  for p in self.files(): self.assertIsNone(forbidden.search(p.read_text()),str(p))
 def test_only_current_currency_rate_is_written(self):
  engine=(ROOT/'modules/addons/cloudhost247_currency/lib/Services/UpdateEngine.php').read_text()
  self.assertIn("table('tblcurrencies')",engine);self.assertIn("array('rate'=>$effective)",engine)
 def test_lock_and_transactions(self):
  engine=(ROOT/'modules/addons/cloudhost247_currency/lib/Services/UpdateEngine.php').read_text()
  self.assertIn("ExecutionLock('rate-update')",engine);self.assertIn('transaction(',engine);self.assertIn('finally',engine)
 def test_admin_csrf_and_auth(self):
  admin=(ROOT/'modules/addons/cloudhost247_currency/lib/Services/AdminController.php').read_text()
  self.assertIn('requireAdmin()',admin);self.assertIn('requirePostToken()',admin)
 def test_cli_only_cron(self):
  cron=(ROOT/'crons/cloudhost247_currency.php').read_text();self.assertIn("PHP_SAPI!=='cli'",cron)
if __name__=='__main__':unittest.main()
