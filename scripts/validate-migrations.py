#!/usr/bin/env python3
from pathlib import Path
import argparse,json,re,sys
p=argparse.ArgumentParser();p.add_argument('--json-output');a=p.parse_args();root=Path(__file__).resolve().parents[1]
expected={'cloudhost247_core':['1.1.0'],'cloudhost247_currency':['1.0.0','1.1.0'],'cloudhost247_theme':['1.0.0','1.1.0'],'cloudhost247_integrations':['1.0.0'],'cloudhost247_modules':['1.0.0','1.1.0'],'cloudhost247_builder':['1.0.0'],'cloudhost247_ovh':['1.0.0','1.1.0','1.2.0','1.3.0','1.4.0','1.5.0','1.6.0'],'cloudhost247_rdp':['1.0.0'],'cloudhost247_smm':['1.0.0'],'cloudhost247_tools':['2.2.7'],'cloudhost247_broker':['1.0.0','1.1.0']};checks=[];failures=[]
for module,versions in expected.items():
 base=(root/'modules/servers/RDP') if module=='cloudhost247_rdp' else (root/'modules/addons'/module);paths=sorted((base/'migrations').glob('V*.php')) if (base/'migrations').exists() else sorted((base/'lib/Database').glob('*Migration.php'));found=[]
 for path in paths:
  text=path.read_text();match=re.search(r"function\s+version\s*\(\)\s*\{\s*return\s*['\"]([^'\"]+)",text);version=match.group(1) if match else None
  if version:found.append(version)
  destructive=bool(re.search(r'->(?:drop|dropIfExists|rename)\s*\(',text,re.I));core=bool(re.search(r"schema\(\)->(?:create|table|drop|rename)\(['\"]tbl",text,re.I));creates=len(re.findall(r"->create\(\s*['\"]",text));guards=len(re.findall(r'hasTable\s*\(',text));idempotent=(guards>=creates and creates>0) or (creates==0 and 'hasColumn' in text);namespaced=not re.search(r"(?:create|table)\(['\"](?!mod_cloudhost247_)",text,re.I)
  reasons=[]
  if not version:reasons.append('missing version')
  if destructive:reasons.append('destructive schema operation')
  if core:reasons.append('WHMCS core schema access')
  if not idempotent:reasons.append('create operation lacks a matching hasTable guard')
  if not namespaced:reasons.append('non-CloudHost247 table mutation')
  item={'module':module,'file':str(path.relative_to(root)),'version':version,'status':'FAIL' if reasons else 'PASS','idempotent_create_guard':idempotent,'additive':not destructive,'namespace_isolated':namespaced and not core,'repeat_execution_safe':idempotent,'reasons':reasons};checks.append(item);failures.extend(item['file']+': '+r for r in reasons)
 if found!=versions:failures.append(f'{module}: expected {versions}, found {found}')
 if len(found)!=len(set(found)):failures.append(f'{module}: duplicate migration version')
report={'schema':'cloudhost247-migration-validation/v1','status':'FAIL' if failures else 'PASS','required_sequence':expected,'migrations':checks,'failures':failures}
if a.json_output:Path(a.json_output).write_text(json.dumps(report,indent=2)+'\n')
for item in checks:print(f"{item['status']} {item['module']} {item['version']} {item['file']}")
if failures:print('\n'.join(failures),file=sys.stderr);sys.exit(1)
print('Migration ordering, uniqueness, additive behavior, namespace isolation and repeat-execution guards passed.')
