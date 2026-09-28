#!/usr/bin/env python3
import argparse,json,sys,datetime
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--preflight',required=True);p.add_argument('--backup',required=True);p.add_argument('--baseline',required=True);p.add_argument('--financial',required=True);p.add_argument('--migration',required=True);p.add_argument('--automated',required=True);p.add_argument('--runtime',required=True);p.add_argument('--commit',required=True);p.add_argument('--json-output',required=True);p.add_argument('--markdown-output',required=True);a=p.parse_args()
def load(path):
 with open(path,encoding='utf-8')as f:return json.load(f)
parts={k:load(getattr(a,k)) for k in ('preflight','backup','baseline','financial','migration','automated','runtime')}
failures=[];warnings=[]
for key in ('preflight','backup','financial','migration','automated'):
 if parts[key].get('status')!='PASS':failures.append(f'{key} evidence is not PASS')
required_runtime=('browser','accessibility','security','currency','ovh','provisioning_lifecycle','reconciliation','cms_theme')
for key in required_runtime:
 status=parts['runtime'].get(key,{}).get('status')
 if status not in ('PASS','PASS WITH DOCUMENTED LIMITATIONS'):failures.append(f'runtime.{key} lacks accepted real staging evidence')
 elif status.endswith('LIMITATIONS'):warnings.extend(parts['runtime'][key].get('limitations',[]))
if parts['preflight'].get('commit')!=a.commit:failures.append('Preflight commit does not match exact tested commit')
status='FAIL' if failures else ('PASS WITH DOCUMENTED LIMITATIONS' if warnings else 'PASS')
report={'schema':'cloudhost247-staging-acceptance/v1','generated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':status,'exact_tested_commit':a.commit,'environment_verification':parts['preflight'],'backup_verification':parts['backup'],'baseline_evidence':parts['baseline'],'migration_results':parts['migration'],'automated_test_results':parts['automated'],'runtime_results':parts['runtime'],'financial_comparison':parts['financial'],'failures':failures,'warnings':warnings,'known_limitations':parts['runtime'].get('known_limitations',[]),'notice':'Static/mock CI alone can never produce staging acceptance.'}
Path(a.json_output).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
lines=['# CloudHost247 staging acceptance report','',f'**Status: {status}**',f'**Exact tested commit:** `{a.commit}`','','## Failures']+[f'- {x}' for x in failures or ['None recorded.']]+['','## Warnings']+[f'- {x}' for x in warnings or ['None recorded.']]+['','## Evidence sections']+[f'- {k}: {v.get("status","RECORDED")}' for k,v in parts.items()]+['','Static/mock CI does not constitute runtime acceptance.']
Path(a.markdown_output).write_text('\n'.join(lines)+'\n',encoding='utf-8');sys.exit(1 if status=='FAIL' else 0)
