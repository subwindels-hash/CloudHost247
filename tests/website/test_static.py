import unittest, importlib.util, copy, re
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

 def test_registry_sections_have_a_renderer_for_every_type(self):
  # scripts/site/generate.mjs decides which section types the PHP surface can render statically;
  # product-sections.tpl decides what they look like. If the two lists drift, a section is projected
  # and then silently dropped from the page, which is how a product page ends up saying less than
  # the application does.
  generator=(ROOT/'scripts/site/generate.mjs').read_text()
  marker='const PHP_SECTION_TYPES = new Set(['
  start=generator.index(marker)+len(marker)
  projected=[name.strip().strip("'\"") for name in generator[start:generator.index(']',start)].split(',') if name.strip()]
  self.assertGreaterEqual(len(projected),5)
  template=(ROOT/'templates/cloudhost247/includes/product-sections.tpl').read_text()
  for section_type in projected:
   if section_type in ('features','cards'):continue  # both render through the default card grid
   self.assertIn("'" + section_type + "'",template,section_type)
  for page in ('cloudhost247-page.tpl','cloudhost247-platform.tpl'):
   self.assertIn('product-sections.tpl',(ROOT/'templates/cloudhost247'/page).read_text(),page)

 def test_published_sections_are_renderable_and_linked(self):
  catalog=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/site.json').read_text())
  types={'features','cards','steps','checks','split','note'}
  pages=0
  for path,page in catalog['pages'].items():
   sections=page.get('sections') or []
   if sections:pages+=1
   for section in sections:
    self.assertIn(section['type'],types,path)
    self.assertTrue(section['heading'].strip(),path)
    if section['type']=='split':
     self.assertTrue(section.get('visual'),path)
     self.assertTrue((ROOT/'assets/images/cloudhost247'/(section['visual']+'.svg')).is_file(),section['visual'])
    for item in section.get('items') or []:
     self.assertTrue(item['title'].strip(),path)
     if item.get('icon'):
      self.assertTrue((ROOT/'assets/images/cloudhost247'/item['icon']).is_file(),item['icon'])
  self.assertGreaterEqual(pages,30,'the shared content should reach most product pages')

 def test_navigation_fragments_are_rendered_anchors(self):
  # `deployments.php#environments` is a promise that the page has that section. Nothing checked it
  # before this test; every domain fragment the menu published was empty.
  catalog=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/site.json').read_text())
  anchors=set()
  for page in catalog['pages'].values():
   for section in page.get('sections') or []:
    if section.get('anchor'):anchors.add(section['anchor'])
  for template in (ROOT/'templates/cloudhost247').rglob('*.tpl'):
   for token in re.findall(r'id="([A-Za-z][\w-]*)"',template.read_text()):
    anchors.add(token)
  registry=json.loads((ROOT/'shared/site/registry.json').read_text())
  destinations=[]
  for menu in registry['menus']:
   destinations.append(menu.get('href') or {})
   for column in menu.get('columns',[]):
    destinations.extend(item.get('href') or {} for item in column.get('items',[]))
  for href in destinations:
   php=href.get('php') or ''
   if '#' not in php:continue
   file,fragment=php.split('#',1)
   self.assertTrue((ROOT/file).is_file(),php)
   self.assertIn(fragment,anchors,php)

if __name__=='__main__':unittest.main()
