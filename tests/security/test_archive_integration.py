from pathlib import Path
import hashlib,unittest,zipfile
ROOT=Path(__file__).resolve().parents[2]
class ArchiveIntegrationTests(unittest.TestCase):
 def test_pages_archive_removed_after_complete_review(self):
  self.assertFalse((ROOT/'pages.zip').exists())
  review=(ROOT/'docs/independent-rebuild/PAGES-ARCHIVE-INTEGRATION-REVIEW.md').read_text()
  controllers=['acceptable-use-policy.php','backup-policy.php','cookie-policy.php','cybercrime-policy.php','data-deletion.php','data-privacy-notice-and-consent-form.php','data-protection-standards.php','domain-agreement.php','domain-renewal-policy.php','domainregistrationaddendum.php','fair-usage-policy.php','faqs.php','help-center.php','legal-notice.php','legal.php','privacy-policy.php','refund-policy.php','terms-of-service.php','trademark-policy.php']
  templates=['acceptableusepolicy.tpl','backuppolicy.tpl','cookiepolicy.tpl','cybercrimepolicy.tpl','datadeletion.tpl','dataprivacynoticeandconsentform.tpl','dataprotectionstandards.tpl','domainagreement.tpl','domainregistrationaddendum.tpl','domainrenewalpolicy.tpl','fairusagepolicy.tpl','faqs.tpl','helpcenter.tpl','legal.tpl','legalnotice.tpl','privacypolicy.tpl','refundpolicy.tpl','termsofservice.tpl','trademarkpolicy.tpl']
  for name in controllers:self.assertTrue((ROOT/name).is_file(),name);self.assertIn('PHP/'+name,review)
  for name in templates:self.assertTrue((ROOT/'templates/hostx'/name).is_file(),name);self.assertIn('TPL/'+name,review)
 def test_rdp_archive_is_untouched_and_inactive(self):
  archive=ROOT/'RDP.zip';self.assertTrue(archive.is_file());self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(),'89bf89129458032ffe9efff4000f5c695d0534cc05e785b3a2602ec9784c5aa2');self.assertFalse((ROOT/'modules/servers/RDP').exists())
  with zipfile.ZipFile(archive) as z:self.assertEqual(len(z.infolist()),20);self.assertIn('RDP.php',z.namelist());self.assertIn('lib/Helper.php',z.namelist())
 def test_no_runtime_source_references_archives(self):
  roots=[ROOT/'modules',ROOT/'templates',ROOT/'crons']
  files=[p for base in roots for p in base.rglob('*') if p.suffix in ('.php','.tpl','.js','.css')]
  files += list(ROOT.glob('*.php'))
  for path in files:
   text=path.read_text(errors='ignore');self.assertNotIn('pages.zip',text,str(path));self.assertNotIn('RDP.zip',text,str(path))
if __name__=='__main__':unittest.main()
