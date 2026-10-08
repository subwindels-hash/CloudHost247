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
  tpl=(ROOT/'templates/cloudhost247/cloudhost247-product-catalog.tpl').read_text()
  self.assertIn('aria-labelledby',tpl);self.assertIn('<caption',tpl)
  # The grid the catalogue renders must be one the theme actually serves. This used to assert
  # `auto-fit` and `@media(max-width:520px)` inside `css/custom.css` while the template rendered
  # `ch247-product-grid` — a class defined *only* in that file, so the page was unstyled in the
  # browser and the test passed anyway. Assert the shipped sheet and the class the template uses.
  for sheet in ('css/design-system.css','css/site.css'):
   css=(ROOT/'templates/cloudhost247'/sheet).read_text()
   self.assertIn('grid-template-columns',css,sheet)
  design=(ROOT/'templates/cloudhost247/css/design-system.css').read_text()
  self.assertIn('.ch-plan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr))',design)
  self.assertIn('ch-plan-grid',tpl)
  self.assertIn('ch-plan',tpl)
  # Every class the catalogue renders is defined by the two sheets the theme loads, in order.
  loaded=(ROOT/'templates/cloudhost247/css/site.css').read_text()+design
  for cls in ('ch-plan-grid','ch-plan','ch-table-wrap','ch-table','ch-visually-hidden','ch-kicker','ch-note','ch-note--warn','ch-btn','ch-btn--mint','ch-btn--outline','ch-btn--sm','ch-section','ch-wrap','ch-section-heading','ch-actions','ch-text-link','ch-muted','ch-notice'):
   self.assertIn('.'+cls,loaded,cls)
 def test_customer_service_kind_fails_safe(self):
  s=(ROOT/'modules/addons/cloudhost247_ovh/lib/Services/ClientServiceView.php').read_text();self.assertIn("'not_verified'",s);self.assertIn("array('hosting','vps','dedicated')",s)
if __name__=='__main__':unittest.main()
