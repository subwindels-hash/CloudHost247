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
 def manager(self): return self.text('modules/addons/cloudhost247_ovh/lib/Products/HostingProductManager.php')
 def between(self,source,start,end):
  i=source.index(start);j=source.index(end,i);return source[i:j]
 def test_product_creation_is_confirmed_transacted_and_rechecked(self):
  s=self.manager();body=self.between(s,'public function create(','private function resolveCreation')
  self.assertIn('Explicit product-creation confirmation is required.',body)
  self.assertIn('Capsule::connection()->transaction(',body)
  # the plan is re-checked inside the write, not only before it
  self.assertIn("assertPlanUnmapped($plan['mapping'])",body);self.assertIn("assertNameAvailable($plan['product']['name']",body)
  self.assertIn("'product.create'",body);self.assertIn('AuditLogger::record',body)
  self.assertIn("if (!$confirmed) {",body)
 def test_a_created_product_cannot_be_ordered_or_provisioned(self):
  s=self.manager()
  self.assertIn("const CYCLE_DISABLED = '-1.00';",s)
  self.assertIn("'hidden' => 1,",s)
  self.assertIn("'orderable_cycles' => 0",s)
  self.assertIn("const AUTO_SETUP = array('', 'order', 'payment');",s)
  self.assertIn("'autosetup' => $autosetup,",s)
  # every cycle and every setup fee is written from the one sentinel, so no
  # column can be left at a price - and 0.00 would mean free in WHMCS pricing.
  self.assertIn('foreach (self::PRICING_SETUP_FEES as $column) { $pricing[$column] = self::CYCLE_DISABLED; }',s)
  self.assertIn('foreach (self::PRICING_CYCLES as $column) { $pricing[$column] = self::CYCLE_DISABLED; }',s)
  self.assertEqual(6,len(__import__('re').findall(r"'(m|q|s|a|b|t)setupfee'",s.split('const PRICING_SETUP_FEES')[1].split(';')[0])))
  self.assertNotIn("'monthly' => 0",s);self.assertNotIn("'monthly' => '0.00'",s)
 def test_creation_never_invents_a_specification_or_a_price(self):
  s=self.manager()
  self.assertIn('No persisted catalog evidence exists for',s)
  self.assertIn('A product is never created from an invented specification.',s)
  self.assertIn('use CloudHost247\\Ovh\\Normalization\\ProductSpecifications;',s)
  self.assertIn('(new ProductSpecifications())->fromPlan($normalized)',s)
  self.assertIn('A price that already exists is never overwritten by creation.',s)
  self.assertIn('if (!$exists) {',s)
 def test_created_mapping_is_inactive_and_the_module_is_allowlisted(self):
  s=self.manager()
  self.assertIn("'active' => false,",s)
  self.assertIn("const SERVER_MODULE = 'cloudhost247_ovh';",s)
  self.assertIn('is not verified by this repository',s)
  self.assertIn("if ($servertype !== '' && $servertype !== self::SERVER_MODULE) {",s)
  self.assertIn('Edit that product instead of creating a second one for the same plan.',s)
  self.assertIn('two identical products are indistinguishable to customers.',s)
 def test_the_creation_preview_writes_nothing(self):
  body=self.between(self.manager(),'public function previewCreate(','public function create(')
  for verb in ('insert(','insertGetId(','update(','updateOrInsert(','delete('):
   self.assertNotIn(verb,body,'previewCreate must be read-only')
  self.assertIn("resolveCreation($input)",body)
 def test_product_creation_is_wired_into_the_capability_gate_and_the_ui(self):
  c=self.text('modules/addons/cloudhost247_ovh/lib/Services/AdminController.php')
  # creating a product is a consequential write; previewing it is not
  self.assertIn("'product_save','product_create','addon_link'",c)
  self.assertIn("op==='product_create_preview'",c);self.assertIn("op==='product_create'",c)
  self.assertIn("'product_create_preview'=>$createPreview",c)
  self.assertIn('$createPreview=null;',c)
  self.assertIn('previewCreate($_POST)',c);self.assertIn("!empty($_POST['confirm'])",c)
  v=self.text('modules/addons/cloudhost247_ovh/cloudhost247_ovh.php')
  self.assertIn('Create a product from catalog evidence',v)
  self.assertIn('value="product_create_preview"',v);self.assertIn('value="product_create"',v)
  self.assertIn('name="confirm"',v);self.assertIn('name="token"',v)
  self.assertIn('created <strong>hidden</strong>',v)
  self.assertIn('HostingProductManager::CYCLE_DISABLED',v)
 def test_creation_behaviour_is_covered_by_the_php_suite(self):
  r=self.text('tests/ovh/run.php')
  for name in ('create preview resolves catalog evidence and writes nothing',
               'create writes the product hidden, unpriced and pointed only at this module',
               'create disables every cycle in every currency and writes no price',
               'one OVH plan maps to one product',
               'a plan with no persisted evidence is refused',
               'every refused creation wrote nothing'):
   self.assertIn(name,r)
if __name__=='__main__': unittest.main()
