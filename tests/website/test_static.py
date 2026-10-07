import unittest, importlib.util, copy
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('verify',ROOT/'scripts/verify-website.py');verify=importlib.util.module_from_spec(spec);spec.loader.exec_module(verify)
class WebsiteTests(unittest.TestCase):
 def setUp(self):self.data=json.loads(verify.CATALOG.read_text())
 def test_registry_links_and_assets(self):self.assertEqual(verify.validate(self.data)[0],[])
 def test_critical_bad_links_fail(self):
  for bad in ['', '#', 'missing-product.php', '//evil.test/', 'https://wrong.test/', '../admin/', 'dedeicated-server.php']:
   data=copy.deepcopy(self.data);data['footer'][0]['links'][0]['url']=bad
   self.assertTrue(verify.validate(data)[0],bad)
 def test_parent_contract_is_preserved(self):
  head=(ROOT/'templates/cloudhost247/header.tpl').read_text();foot=(ROOT/'templates/cloudhost247/footer.tpl').read_text()
  for item in ['$headoutput','$headeroutput','getMarkup()','phoneNumberInputStyle','includes/validateuser.tpl','includes/verifyemail.tpl','includes/sidebar.tpl','user-accounts','adminMasqueradingAsClient']:
   self.assertIn(item,head)
  for item in ['$footeroutput','modalAjax','modalChooseLanguage','includes/generate-password.tpl','modal-submit']:
   self.assertIn(item,foot)
 def test_builder_parts_keep_priority(self):
  self.assertIn('!$ch247Builder.header_html',(ROOT/'templates/cloudhost247/header.tpl').read_text())
  self.assertIn('!$ch247Builder.footer_html',(ROOT/'templates/cloudhost247/includes/site-footer.tpl').read_text())
 def test_read_only_catalog_and_safe_dom(self):
  js=(ROOT/'templates/cloudhost247/js/site.js').read_text()
  self.assertIn("'operating-systems'",js);self.assertIn('ApplicationLogo',js);self.assertNotIn('innerHTML',js)
  self.assertNotIn("method: 'POST'",js);self.assertIn("credentials: 'omit'",js)
 def test_no_sample_claims_in_announcement_config(self):
  text=(ROOT/'templates/cloudhost247/includes/announcementbar-config.tpl').read_text()
  self.assertIn('value=[]',text)
 def test_legal_text_has_its_own_layout(self):
  for path in (ROOT/'templates/cloudhost247/includes/legal').glob('*.tpl'):
   text=path.read_text();self.assertNotIn('<style',text,str(path));self.assertNotIn('<script',text,str(path))
 def test_design_system_is_loaded_after_the_theme_stylesheet(self):
  # The theme and the application share one design system. Both stylesheets style the same `ch-*`
  # class names, so load order is behaviour: site.css first, design-system.css second. Reversing
  # them silently reverts the whole WHMCS site to the old palette.
  head=(ROOT/'templates/cloudhost247/includes/site-head.tpl').read_text()
  self.assertIn('design-system.css',head)
  self.assertLess(head.index('site.css'),head.index('design-system.css'),'design-system.css must load after site.css')

 def test_generated_design_system_matches_its_source(self):
  source=(ROOT/'shared/site/design-system.css').read_text().strip()
  copy=(ROOT/'templates/cloudhost247/css/design-system.css').read_text()
  self.assertIn('GENERATED COPY of shared/site/design-system.css',copy)
  self.assertEqual(copy[copy.index('*/')+2:].strip(),source)

 def test_theme_navigation_and_footer_come_from_the_registry(self):
  catalog=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/site.json').read_text())
  self.assertTrue(catalog.get('navigation'),'navigation is generated from shared/site/registry.json')
  self.assertTrue(catalog.get('footer'),'footer is generated from shared/site/registry.json')
  self.assertGreaterEqual(len(catalog['navigation']),9)
  self.assertGreaterEqual(len(catalog['footer']),9)
  # The Tools menu's entries are live data (the tool catalogue), so the registry deliberately has
  # no static columns for it; the template renders categories from `toolCategories` and site.js
  # enriches them. Every other menu must carry its own groups.
  self.assertTrue(catalog.get('toolCategories'),'tools categories are generated for the PHP menu')
  nav=(ROOT/'templates/cloudhost247/includes/site-nav.tpl').read_text()
  self.assertIn('ch247Site.toolCategories',nav)
  for menu in catalog['navigation']:
   if menu['title'] == 'Tools': continue
   self.assertTrue(menu['groups'],menu['title'])
  # Product pages inherit their copy from the same content the application renders.
  enriched=[p for p in catalog['pages'].values() if p.get('headline') and p.get('features')]
  self.assertGreaterEqual(len(enriched),30,'expected the shared content to enrich the PHP product pages')

if __name__=='__main__':unittest.main()
