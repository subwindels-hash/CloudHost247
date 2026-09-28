from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
class ProductServiceSourceTests(unittest.TestCase):
 def text(self,path): return (ROOT/path).read_text()
 def test_product_metadata_is_separate_from_core(self):
  s=self.text('modules/addons/cloudhost247_ovh/migrations/V140.php');self.assertIn('mod_cloudhost247_hosting_products',s);self.assertNotIn("schema()->table('tblproducts'",s)
 def test_product_and_addon_duplicates_are_constrained(self):
  s=self.text('modules/addons/cloudhost247_ovh/migrations/V140.php');self.assertIn("'whmcs_product_id')->unique()",s);self.assertIn('ch247_product_addon_unique',s)
 def test_product_writes_need_confirmation_and_transaction(self):
  s=self.text('modules/addons/cloudhost247_ovh/lib/Products/HostingProductManager.php');self.assertGreaterEqual(s.count('Explicit'),2);self.assertIn('transaction(',s)
 def test_product_kinds_and_availability_are_allowlisted(self):
  s=self.text('modules/addons/cloudhost247_ovh/lib/Products/HostingProductManager.php');self.assertIn("array('hosting','vps','dedicated')",s);self.assertIn("array('available','limited','unavailable','unknown')",s)
 def test_client_service_is_ownership_scoped(self):
  s=self.text('modules/addons/cloudhost247_ovh/lib/Services/ClientServiceView.php');self.assertIn("where('h.userid'",s);self.assertNotIn('password',s.lower())
 def test_unknown_provider_state_is_not_verified(self):
  s=self.text('modules/addons/cloudhost247_ovh/lib/Services/ProvisioningStatePresenter.php');self.assertIn("'not_verified'",s);self.assertIn("'Not Verified'",s)
 def test_client_markup_is_responsive_and_accessible(self):
  s=self.text('modules/servers/cloudhost247_ovh/templates/clientarea.tpl');self.assertIn('aria-labelledby',s);self.assertIn('@media(max-width:600px)',s);self.assertIn('overflow-wrap:anywhere',s)
if __name__=='__main__': unittest.main()
