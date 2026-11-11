import json, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
class ManifestVisuals(unittest.TestCase):
 def test_complete_marks_and_manifest_directory(self):
  apps=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/applications.json').read_text())['apps']
  self.assertEqual({a['slug'] for a in apps},{p.name for p in (ROOT/'cloudhost247-node/manifests').iterdir() if p.is_dir()})
  for a in apps:
   self.assertTrue(a['versions']);self.assertTrue(a['deployment']);self.assertTrue(a['requirements'])
   source=ROOT/'assets/images/cloudhost247'/a['mark']
   served=ROOT/'cloudhost247-node/frontend/public/media/cloudhost247'/a['mark']
   self.assertEqual(source.read_bytes(),served.read_bytes())
   self.assertIn('neutral CloudHost247',source.read_text())
 def test_preview_serves_selected_encoding(self):
  self.assertIn("'.avif'",(ROOT/'tests/website/preview.py').read_text())
 def test_menu_landing_uses_registry(self):
  self.assertIn('{$menu.url|escape}',(ROOT/'templates/cloudhost247/includes/site-nav.tpl').read_text())


class StorefrontHeroParity(unittest.TestCase):
 def test_custom_storefronts_render_their_own_distinct_svg_on_both_surfaces(self):
  import hashlib
  pages=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/site.json').read_text())['pages']
  mapping={'rdp-hosting':'RdpHostingPage','smm-services':'SmmServicesPage','number-services':'NumberServicesPage','google-workspace':'GoogleWorkspacePage','office-365':'Office365Page','digital-products':'DigitalProductsPage','proxy-services':'ProxyServicesPage','smtp-hosting':'SmtpHostingPage'}
  digests=set()
  for slug,component in mapping.items():
   with self.subTest(slug=slug):
    page=pages[slug+'.php'];key=page['visual']+'.svg'
    self.assertEqual(page['visualFormat'],'svg')
    self.assertFalse(page.get('visual3d'),'SVG-only storefront must not inherit a shared raster hero')
    source=ROOT/'assets/images/cloudhost247'/key
    public=ROOT/'cloudhost247-node/frontend/public/media/cloudhost247'/key
    self.assertEqual(source.read_bytes(),public.read_bytes())
    digests.add(hashlib.sha256(source.read_bytes()).hexdigest())
    self.assertIn('/assets/images/cloudhost247/'+key,(ROOT/'templates/cloudhost247'/(slug+'.tpl')).read_text())
    self.assertIn('/media/cloudhost247/'+key,(ROOT/'cloudhost247-node/frontend/src/pages'/(component+'.tsx')).read_text())
  self.assertEqual(len(digests),len(mapping),'different filenames must not hide duplicate artwork')
