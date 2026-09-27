from pathlib import Path
import json,subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[2]
class StagingToolTests(unittest.TestCase):
 def command(self,*args):return subprocess.run(args,cwd=ROOT,text=True,capture_output=True)
 def test_migration_report_passes(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d)/'m.json';r=self.command('python3','scripts/validate-migrations.py','--json-output',str(out));self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(out.read_text())['status'],'PASS')
 def test_financial_comparison_fails_unexpected_change(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);before={'commit':'a','tables':{'tblinvoices':{'rows':1,'sha256':'a','totals':{'total':'10'}}}};after={'commit':'b','tables':{'tblinvoices':{'rows':1,'sha256':'b','totals':{'total':'11'}}}};(p/'b.json').write_text(json.dumps(before));(p/'a.json').write_text(json.dumps(after));r=self.command('python3','scripts/compare-financial-evidence.py',str(p/'b.json'),str(p/'a.json'));self.assertNotEqual(r.returncode,0);self.assertIn('UNEXPECTED CHANGE',r.stdout)
 def test_financial_comparison_requires_reason_for_expected_change(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);base={'commit':'a','tables':{'tblpricing':{'rows':1,'sha256':'a','totals':{}}}};changed={'commit':'b','tables':{'tblpricing':{'rows':1,'sha256':'b','totals':{}}}};(p/'b').write_text(json.dumps(base));(p/'a').write_text(json.dumps(changed));(p/'policy').write_text(json.dumps({'expected_changes':{'tblpricing':{'reason':''}}}));r=self.command('python3','scripts/compare-financial-evidence.py',str(p/'b'),str(p/'a'),'--expected',str(p/'policy'));self.assertNotEqual(r.returncode,0)
 def test_financial_comparison_accepts_documented_expected_change(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);base={'commit':'a','tables':{'tblpricing':{'rows':1,'sha256':'a','totals':{}}}};changed={'commit':'b','tables':{'tblpricing':{'rows':1,'sha256':'b','totals':{}}}};(p/'b').write_text(json.dumps(base));(p/'a').write_text(json.dumps(changed));(p/'policy').write_text(json.dumps({'expected_changes':{'tblpricing':{'reason':'Confirmed disposable product price test','before_sha256':'a','after_sha256':'b'}}}));r=self.command('python3','scripts/compare-financial-evidence.py',str(p/'b'),str(p/'a'),'--expected',str(p/'policy'));self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIn('EXPECTED CHANGE',r.stdout)
 def test_acceptance_report_fails_without_runtime_evidence(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);good={'status':'PASS','commit':'abc'};baseline={'status':'CAPTURED_NOT_ACCEPTED'};runtime={};
   for name,data in [('preflight',good),('backup',good),('baseline',baseline),('financial',good),('migration',good),('automated',good),('runtime',runtime)]: (p/name).write_text(json.dumps(data))
   cmd=['python3','scripts/generate-staging-report.py'];
   for name in ('preflight','backup','baseline','financial','migration','automated','runtime'):cmd += ['--'+name,str(p/name)]
   cmd += ['--commit','abc','--json-output',str(p/'out.json'),'--markdown-output',str(p/'out.md')];r=self.command(*cmd);self.assertNotEqual(r.returncode,0);self.assertEqual(json.loads((p/'out.json').read_text())['status'],'FAIL')
 def test_staging_scripts_are_cli_and_confirmation_gated(self):
  for name in ('staging-preflight.php','staging-baseline-evidence.php','staging-financial-snapshot.php','staging-backup-verify.php'):
   s=(ROOT/'scripts'/name).read_text();self.assertIn('staging-common.php',s)
  common=(ROOT/'scripts/lib/staging-common.php').read_text();self.assertIn("CH247_STAGING_CONFIRM",common);self.assertIn('CH247_STAGING_HOST_ALLOWLIST',common);self.assertIn('CH247_STAGING_DB_MARKER',common)
if __name__=='__main__':unittest.main()
