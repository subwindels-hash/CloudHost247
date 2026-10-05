#!/usr/bin/env python3
"""Rebuild current inventories from Git-visible files; never guess routes from documentation."""
import csv,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/website-rebuild'
CATEGORIES=['Marketing','Product','Hosting','Cloud','VPS','Dedicated','Domains','Email','Developer','Applications','Deployment/PaaS','Operating Systems','Server Management','Business','Support','Legal','Client Area','Authentication','Checkout','Administrative/internal']
def category(path):
 if path in ('builder-page.php','cloudhost247-page.php'):return 'Marketing'
 s=('/'+path.lower()).replace('cloudhost247_legacy','').replace('cloudhost247-node','').replace('cloudhost247','')
 if any(x in s for x in ['/vendor/','/tests/','/migrations/','/lib/','/crons/','/scripts/','/admin/','admincontroller','callback','bootstrap','-track.php','sitemap','sample','all-element','future-element','tables.php']):return 'Administrative/internal'
 for group,pattern in [('Legal','policy|privacy|legal|terms|agreement|addendum|consent|data-deletion|data-protection'),('Authentication','login|register|pwreset|password|auth|passkey|oauth'),('Checkout','orderform|cart|checkout|payment|invoice|quote'),('Client Area','clientarea|client-area|account|clientregister'),('Domains','domain|whois|dns|nameserver'),('Email','email|smtp|mail'),('Deployment/PaaS','deploy|paas|pipeline'),('Operating Systems','operating.system|os.image'),('Server Management','monitor|firewall|server.control|backup|server-management'),('Dedicated','dedicated|dedeicated|enterprise-server|game-server'),('VPS','vps'),('Cloud','cloud|infrastructure'),('Developer','developer|api|tools'),('Applications','application|wordpress|docker|laravel'),('Hosting','hosting|cpanel|plesk'),('Support','help|support|ticket|faq|knowledge|status|contact'),('Business','affiliate|business|website-design'),('Marketing','about|blog|homepage|offers|announcement|comingsoon|notfound|search')]:
  if re.search(pattern,s):return group
 return 'Administrative/internal'
paths=sorted(set(subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()))
paths=[p for p in paths if (ROOT/p).is_file() and not p.startswith('docs/website-rebuild/')]
with (OUT/'current-files.csv').open('w') as f:
 w=csv.writer(f,lineterminator='\n');w.writerow(['path','category','bytes'])
 for p in paths:w.writerow([p,category(p),(ROOT/p).stat().st_size])
# Classifications can be improved without changing the recorded baseline content hashes.
for filename,column in [('baseline-files.csv','path'),('baseline-templates.csv','template')]:
 p=OUT/filename
 with p.open() as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
 for row in rows:
  row['category']=category(row[column])
  for key in fields:row[key]=row[key].rstrip()
 with p.open('w') as f:w=csv.DictWriter(f,fieldnames=fields,lineterminator='\n');w.writeheader();w.writerows(rows)
registry=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/site.json').read_text())['pages']
baseline=json.loads((OUT/'baseline-routes.json').read_text());original={p['path'] for p in baseline}
for row in baseline:row['category']=('Marketing' if registry.get(row['path'],{}).get('category') == 'Company' else registry.get(row['path'],{}).get('category',category(row['path'])))
(OUT/'baseline-routes.json').write_text(json.dumps(baseline,indent=2)+'\n')
routes=[]
for path in sorted(ROOT.glob('*.php')):
 text=path.read_text();published=re.search(r"PublicPage::(?:route|notFound)\([^;]+",text);templates=re.findall(r"setTemplate\('([^']+)'\)",text)
 routes.append({'path':path.name,'category':('Marketing' if registry.get(path.name,{}).get('category') == 'Company' else registry.get(path.name,{}).get('category',category(path.name))),'original':path.name in original,'renderer':published.group(0) if published else ', '.join(templates),'http':'requires licensed WHMCS staging' if 'init.php' in text else 'not exercised','template_status':'shared first-party shell and content templates' if path.name in registry or published else 'existing route preserved; review renderer','dependency':'WHMCS init.php' if 'init.php' in text else 'none / inspect'})
(OUT/'current-routes.json').write_text(json.dumps(routes,indent=2)+'\n')
node=[]
for file in (ROOT/'cloudhost247-node/src/routes').rglob('*.ts'):
 text=file.read_text()
 for method,url in re.findall(r"app\.(get|post|patch|delete|put)(?:<[^;]*?>)?\(\s*['\"]([^'\"]+)",text):node.append({'source':str(file.relative_to(ROOT)),'method':method.upper(),'path':url,'category':'Administrative/internal' if '/admin/' in url else category(url)})
(OUT/'node-api-routes.json').write_text(json.dumps(node,indent=2)+'\n')
print(json.dumps({'baseline_root_php':len(baseline),'current_root_php':len(routes),'added_root_php':len(routes)-len(baseline),'registered_editorial_pages':len(registry),'node_api_routes':len(node),'node_frontend_routes':len(json.loads((OUT/'baseline-node-routes.json').read_text())),'git_visible_files':len(paths),'categories':CATEGORIES},indent=2))
