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
if __name__=='__main__':unittest.main()
