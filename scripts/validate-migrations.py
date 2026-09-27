#!/usr/bin/env python3
from pathlib import Path
import re,sys
root=Path(__file__).resolve().parents[1]
expected={'cloudhost247_core':['1.1.0'],'cloudhost247_currency':['1.0.0','1.1.0'],'cloudhost247_theme':['1.0.0','1.1.0'],'cloudhost247_ovh':['1.0.0','1.1.0','1.2.0','1.3.0','1.4.0','1.5.0']}
failed=[]
for module,versions in expected.items():
 paths=sorted((root/'modules/addons'/module/'migrations').glob('V*.php')) if (root/'modules/addons'/module/'migrations').exists() else sorted((root/'modules/addons'/module/'lib/Database').glob('*Migration.php'))
 found=[]
 for path in paths:
  text=path.read_text()
  match=re.search(r"function\s+version\s*\(\)\s*\{\s*return\s*['\"]([^'\"]+)",text)
  if match: found.append(match.group(1))
  lower=text.lower()
  if any(x in lower for x in ('->drop(', 'dropifexists', '->rename(')): failed.append(f'{path}: destructive schema operation')
  if re.search(r"schema\(\)->(?:create|table|drop|rename)\(['\"]tbl",text,re.I): failed.append(f'{path}: WHMCS core schema access')
 if found!=versions: failed.append(f'{module}: expected {versions}, found {found}')
if failed:
 print('\n'.join(failed),file=sys.stderr);sys.exit(1)
print('Migration ordering and additive-schema policy passed for all CloudHost247 modules.')
