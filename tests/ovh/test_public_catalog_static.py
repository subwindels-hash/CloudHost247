from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
class PublicCatalogSourceTests(unittest.TestCase):
 def test_catalog_uses_only_visible_verified_available_products(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Products/PublicCatalog.php').read_text();self.assertIn("where('p.hidden',0)",s);self.assertIn("where('g.hidden',0)",s);self.assertIn("array('available','limited')",s);self.assertIn('limit(200)',s)
 def test_catalog_pricing_comes_from_whmcs(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Products/PublicCatalog.php').read_text();self.assertIn("Capsule::table('tblpricing')",s);self.assertIn("where('currency'",s);self.assertNotIn('source_price',s)
 def test_catalog_cta_uses_native_cart(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Products/PublicCatalog.php').read_text();self.assertIn("cart.php?a=add&pid=",s)
 def test_public_template_escapes_and_handles_unverified_pricing(self):
  s=(ROOT/'templates/cloudhost247/cloudhost247-product-catalog.tpl').read_text();self.assertIn('Pricing: NOT VERIFIED',s);self.assertIn('Configure in WHMCS',s);self.assertGreaterEqual(s.count('|escape'),10)
 def test_public_catalog_is_responsive_and_accessible(self):
  tpl=(ROOT/'templates/cloudhost247/cloudhost247-product-catalog.tpl').read_text();css=(ROOT/'templates/cloudhost247/css/custom.css').read_text();self.assertIn('aria-labelledby',tpl);self.assertIn('<caption',tpl);self.assertIn('auto-fit',css);self.assertIn('@media(max-width:520px)',css)
 def test_customer_service_kind_fails_safe(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Services/ClientServiceView.php').read_text();self.assertIn("'not_verified'",s);self.assertIn("array('hosting','vps','dedicated')",s)
if __name__=='__main__':unittest.main()
