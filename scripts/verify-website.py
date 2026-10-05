#!/usr/bin/env python3
"""Fail-closed source navigation/asset gate; optional read-only staging HTTP verification."""
import argparse,json,re,sys,urllib.request,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/'modules/addons/cloudhost247_theme/resources/site.json'
# Licensed WHMCS entry points, deliberately not vendored. HTTP mode verifies their deployment.
WHMCS={'index.php','cart.php','clientarea.php','register.php','logout.php','pwreset.php','contact.php','knowledgebase.php','submitticket.php','serverstatus.php','announcements.php','supporttickets.php','viewticket.php','domainchecker.php'}
def validate(data):
 errors=[];links=[]
 for menu in data['navigation']:
  for group in menu['groups']:links+=group['links']
 for group in data['footer']:links+=group['links']
 for link in links:
  url=link.get('url','');p=urllib.parse.urlsplit(url)
  if not url or url.startswith('#') or p.scheme or p.netloc or '..' in p.path.split('/') or p.path.startswith('/'):
   errors.append('Unsafe/placeholder navigation URL: '+repr(url));continue
  if p.path not in WHMCS and not (ROOT/p.path).is_file():errors.append('Missing navigation route: '+url)
  if p.path=='dedeicated-server.php':errors.append('Navigation must use canonical dedicated-server.php')
  if not link.get('label','').strip():errors.append('Empty navigation label: '+url)
 for path,page in data['pages'].items():
  if not (ROOT/path).is_file():errors.append('Missing registry route: '+path)
  asset=ROOT/'assets/images/cloudhost247'/(page['visual']+'.svg')
  if not asset.is_file():errors.append('Missing product illustration: '+str(asset))
  for related in page.get('related',[]):
   if related not in data['pages']:errors.append('Unknown related service: '+related)
 # Every original PHP entry point must remain present, including compatibility and utility routes.
 baseline=json.loads((ROOT/'docs/website-rebuild/baseline-routes.json').read_text())
 for row in baseline:
  if not (ROOT/row['path']).is_file():errors.append('Original route removed: '+row['path'])
 # Critical shell has no dummy anchor destinations or ad hoc external footer URLs.
 for name in ['site-nav.tpl','site-footer.tpl']:
  text=(ROOT/'templates/cloudhost247/includes'/name).read_text()
  for href in re.findall(r'href="([^"]*)"',text):
   if href in ('','#') or re.match(r'https?://',href):errors.append(name+': unsafe link '+href)
 # Literal asset references in all first-party child templates.
 for file in (ROOT/'templates/cloudhost247').rglob('*.tpl'):
  for url in re.findall(r'(?:src|href)="([^"]+)"',file.read_text()):
   clean=url.replace('{$WEB_ROOT}/','').replace('{$template}','cloudhost247').split('?',1)[0]
   if '{$' in clean or '{if' in clean:continue
   if clean.startswith(('assets/','templates/')) and not (ROOT/clean).is_file():errors.append(str(file.relative_to(ROOT))+': missing '+clean)
 # Parent-provided WHMCS loading spinner is checked at runtime; it is not repository-owned.
 errors=[e for e in errors if not e.endswith('missing assets/img/overlay-spinner.svg')]
 return errors,sorted(set(x['url'] for x in links))
def http_check(base,urls):
 from html.parser import HTMLParser
 class Page(HTMLParser):
  def __init__(self):super().__init__();self.in_title=False;self.title='';self.assets=[];self.text='';self.links=[];self.footer=False;self.bad_footer=[]
  def handle_starttag(self,tag,attrs):
   a=dict(attrs)
   if tag=='title':self.in_title=True
   if tag=='footer':self.footer=True
   if tag=='a':
    href=a.get('href','');self.links.append(href)
    if self.footer and (not href or href=='#' or href.startswith('javascript:')):self.bad_footer.append(href)
   if tag in ('img','script') and a.get('src'):self.assets.append(a['src'])
   if tag=='link' and a.get('rel')=='stylesheet':self.assets.append(a.get('href',''))
  def handle_endtag(self,tag):
   if tag=='title':self.in_title=False
   if tag=='footer':self.footer=False
  def handle_data(self,text):
   self.text+=text
   if self.in_title:self.title+=text
 errors=[];responses=[];assets=set();internal=set()
 for url in urls:
  target=urllib.parse.urljoin(base.rstrip('/')+'/',url)
  try:
   with urllib.request.urlopen(target,timeout=20) as response:
    html=response.read(3000000).decode('utf-8','replace');status=response.status
   parser=Page();parser.feed(html)
   checks={'status':status,'title':bool(parser.title.strip()),'brand':'CloudHost247' in html,'header':'ch-header' in html,'mega_menu':'ch-mega' in html,'footer':'ch-footer' in html,'fatal':bool(re.search(r'Fatal error:|Uncaught (?:Error|Exception)',html))}
   if status!=200 or not all(checks[k] for k in ('title','brand','header','mega_menu','footer')) or checks['fatal']:errors.append(url+': '+str(checks))
   responses.append(dict(url=url,**checks))
   if parser.bad_footer:errors.append(url+': placeholder footer links '+repr(parser.bad_footer))
   for href in parser.links:
    full=urllib.parse.urljoin(target,href);parsed=urllib.parse.urlsplit(full)
    if parsed.netloc==urllib.parse.urlsplit(base).netloc and parsed.scheme in ('http','https') and not parsed.fragment:
     name=Path(parsed.path).name
     if name in json.loads(CATALOG.read_text())['pages'] or name in {'index.php','contact.php','knowledgebase.php','announcements.php','serverstatus.php','register.php'}:internal.add(full)
   for asset in parser.assets:
    full=urllib.parse.urljoin(target,asset)
    if urllib.parse.urlsplit(full).netloc==urllib.parse.urlsplit(base).netloc:assets.add(full)
  except Exception as exc:errors.append(url+': '+str(exc));responses.append({'url':url,'error':str(exc)})
 for asset in sorted(assets | internal):
  try:
   with urllib.request.urlopen(asset,timeout=20) as response:
    if response.status!=200:errors.append('Asset: '+asset)
  except Exception as exc:errors.append('Asset: '+asset+' '+str(exc))
 return errors,responses
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--base',help='Staging WHMCS base URL (never runs mutations)');ap.add_argument('--output');args=ap.parse_args()
 data=json.loads(CATALOG.read_text());errors,urls=validate(data);result={'registry_pages':len(data['pages']),'navigation_destinations':len(urls),'source_errors':errors.copy(),'http':'not run; WHMCS staging required'}
 if args.base:
  targets=sorted(set(list(data['pages'])+[u for u in urls if not u.startswith(('logout.php','cart.php','clientarea.php'))]))
  remote,responses=http_check(args.base,targets);errors+=remote;result['http']=responses;result['http_errors']=remote
 result['passed']=not errors
 if args.output:Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2));sys.exit(1 if errors else 0)
