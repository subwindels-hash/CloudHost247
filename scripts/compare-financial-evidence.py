#!/usr/bin/env python3
import argparse,json,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('before');p.add_argument('after');p.add_argument('--expected');p.add_argument('--output');a=p.parse_args()
def load(path):
 with open(path,encoding='utf-8')as f:return json.load(f)
before,after=load(a.before),load(a.after);policy=load(a.expected) if a.expected else {'expected_changes':{}};expected_policy=policy.get('expected_changes',{});changes=[];unexpected=[]
for table in sorted(set(before.get('tables',{}))|set(after.get('tables',{}))):
 b=before.get('tables',{}).get(table);n=after.get('tables',{}).get(table)
 if b==n:continue
 rule=expected_policy.get(table,{}) if isinstance(expected_policy.get(table,{}),dict) else {};reason=str(rule.get('reason','')).strip();fingerprints=reason and rule.get('before_sha256')==(b or {}).get('sha256') and rule.get('after_sha256')==(n or {}).get('sha256');totals_ok='after_totals' not in rule or rule.get('after_totals')==(n or {}).get('totals',{});expected=bool(fingerprints and totals_ok)
 item={'table':table,'classification':'EXPECTED CHANGE' if expected else 'UNEXPECTED CHANGE','reason':reason,'before':{'rows':(b or {}).get('rows'),'sha256':(b or {}).get('sha256'),'totals':(b or {}).get('totals',{})},'after':{'rows':(n or {}).get('rows'),'sha256':(n or {}).get('sha256'),'totals':(n or {}).get('totals',{})}}
 changes.append(item)
 if not expected:unexpected.append(table)
report={'schema':'cloudhost247-financial-comparison/v1','status':'FAIL' if unexpected else 'PASS','before_commit':before.get('commit'),'after_commit':after.get('commit'),'changes':changes,'unexpected_tables':unexpected,'rule':'Every changed table requires a reason and exact before/after SHA-256 fingerprints; optional after_totals must also match. Otherwise acceptance fails.'}
data=json.dumps(report,indent=2)+'\n'
if a.output:Path(a.output).write_text(data,encoding='utf-8')
else:print(data,end='')
sys.exit(1 if unexpected else 0)
