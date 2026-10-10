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
