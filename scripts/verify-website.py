#!/usr/bin/env python3
"""Fail-closed source navigation/asset gate; optional read-only staging HTTP verification."""
import argparse,json,re,sys,urllib.request,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/'modules/addons/cloudhost247_theme/resources/site.json'
# Licensed WHMCS entry points, deliberately not vendored. HTTP mode verifies their deployment.
WHMCS={'index.php','cart.php','clientarea.php','register.php','logout.php','pwreset.php','contact.php','knowledgebase.php','submitticket.php','serverstatus.php','announcements.php','supporttickets.php','viewticket.php','domainchecker.php'}
def tool_routes():
 # `tools.json` is the projection the PHP theme runtime resolves against (ToolsSite::catalog());
 # `tools-public.json` is the older engine export and is kept as a second accepted source, so the
 # gate matches what the deployed surface can actually answer instead of one file's opinion.
 routes={'tools'}
 for name in ('tools.json','tools-public.json'):
  catalog=ROOT/'modules/addons/cloudhost247_theme/resources'/name
  if not catalog.is_file():continue
  data=json.loads(catalog.read_text())
  for tool in data.get('tools',[]):
   if isinstance(tool.get('path'),str):routes.add(tool['path'].lstrip('/'))
   for legacy in tool.get('legacyPaths',[]):
    if isinstance(legacy,str) and legacy.startswith('/tools/'):routes.add(legacy.lstrip('/'))
  for slug in data.get('categories',{}):routes.add('tools/category/'+slug)
  # Curated collections (e.g. Compliance & Document Tools) are hub pages the PHP tools front
  # controller serves alongside the per-tool routes, so the nav may link one exactly as it links a
  # tool. scripts/site/generate.mjs applies the same rule when it validates the registry.
  for collection in data.get('collections',[]):
   if isinstance(collection.get('path'),str):routes.add(collection['path'].lstrip('/'))
 return routes
def route_exists(path):
 if path in WHMCS or path in tool_routes():return True
 return (ROOT/path).is_file()
# Stylesheets every first-party page loads, in load order (templates/cloudhost247/includes/site-head.tpl).
THEME_SHEETS=('css/site.css','css/design-system.css')
def _sheet_text(name):
 p=ROOT/'templates/cloudhost247'/name
 return p.read_text() if p.is_file() else ''
def _class_tokens(attribute):
 """Completed class names in one class attribute.

 A whitespace-delimited chunk that still contains a Smarty expression is not a finished class name:
 it is either assembled at render (`ch247-provider-card--{$key}`) or a vendor icon split by a
 conditional (`fa-{if …}check-circle{/if}`). Those chunks are skipped rather than reported, so the
 check reports only classes the template states literally — conservative, but never a false alarm."""
 return [chunk for chunk in attribute.split() if not re.search(r'[{$}]',chunk)]
def palette_errors():
 """A page stylesheet may use its own short names, but not its own accent colour.

 `email-hosting.css` shipped `--ch247-email-accent: #1c64f2` — a private blue palette that no other
 page used, so one public page carried a different accent from every other page on the site. Every
 brand-defining custom property in a page namespace has to alias a shared design token instead. The
 token owners themselves (`site.css`, `design-system.css`) are out of scope: they are where the
 literals are supposed to live."""
 errors=[]
 watched=re.compile(r'(--ch247-[\w-]+?)-(accent|primary|brand)[\w-]*\s*:\s*([^;]+);')
 for sheet in sorted((ROOT/'templates/cloudhost247/css').glob('*.css')):
  if sheet.name in ('site.css','design-system.css'):continue
  for name,kind,value in watched.findall(sheet.read_text()):
   if 'var(--ch' in value:continue
   errors.append(sheet.relative_to(ROOT).as_posix()+f': {name}-{kind} sets its own colour ({value.strip()}); use a shared design token')
 return errors

def class_errors():
 """Every first-party class a template renders must be defined by a sheet the theme itself loads.

 This is the check that would have caught three real defects at once: the product catalogue and the
 Builder page rendered `ch247-*` classes that only ever existed in `css/custom.css`, and the global
 header labelled its search fields with `ch-sr`, which only `tools.css` defines. In every case the
 page rendered unstyled or unlabelled in the browser while the stylesheet pins in the test suite
 passed, because those pins named the sheets the author *believed* were loaded."""
 errors=[];audited=0
 for template in sorted((ROOT/'templates/cloudhost247').rglob('*.tpl')):
  text=template.read_text()
  available=''.join(_sheet_text(name) for name in THEME_SHEETS)
  # A template may declare extra sheets itself (`cloudhost247-tools.tpl` loads tools.css).
  for href in re.findall(r'href="[^"]*/([\w.-]+\.css)',text):
   available+=_sheet_text('css/'+href)
  # The Builder renders its own runtime stylesheet into the page head from the addon's hook, and
  # every class it scopes under `.ch247-root` is defined there rather than in the theme.
  if template.name=='cloudhost247-builder-page.tpl':
   runtime=ROOT/'modules/addons/cloudhost247_builder/assets/css/runtime.css'
   available+=runtime.read_text() if runtime.is_file() else ''
  used=[]
  for attribute in re.findall(r'class="([^"]*)"',text):
   for token in _class_tokens(attribute):
    if token.startswith('ch'):used.append(token)
  audited+=len(used)
  undefined=sorted({token for token in used if not re.search(r'\.'+re.escape(token)+r'(?![\w-])',available)})
  if undefined:
   errors.append(str(template.relative_to(ROOT))+': renders undefined class(es) '+', '.join('.'+c for c in undefined))
 return errors,audited
# Templates a child theme deliberately does not ship, because WHMCS loads them from the theme named
# in its `parent:` declaration. `templates/cloudhost247` is a child of `twenty-one` and overrides only
# what it restyles, so the platform's own head/navbar/sidebar partials arrive from the parent at
# render time and are absent here by design. The distinction matters: an include that is neither
# shipped nor covered by a parent is not a style question, it is a hole in the page — the head comes
# back without the platform's own markup, or the page fatals. Nothing in the repository said which
# absences were deliberate, so nothing could tell a deliberate one from a typo.
#
# Keyed by (theme directory, path as the template writes it): a child may reach its parent either
# through `$template/…` (the active theme, which inherits) or by naming the parent's directory.
PARENT_TEMPLATES={
 ('templates/cloudhost247','includes/head.tpl'):'WHMCS head partial (charset, jQuery, bootstrap, template CSS) from twenty-one',
 ('templates/cloudhost247','includes/breadcrumb.tpl'):'WHMCS breadcrumb trail from twenty-one',
 ('templates/cloudhost247','includes/generate-password.tpl'):'WHMCS password generator modal from twenty-one',
 ('templates/cloudhost247','includes/navbar.tpl'):'WHMCS client-area navbar from twenty-one',
 ('templates/cloudhost247','includes/network-issues-notifications.tpl'):'WHMCS network status notice from twenty-one',
 ('templates/cloudhost247','includes/sidebar.tpl'):'WHMCS client-area sidebar from twenty-one',
 ('templates/cloudhost247','includes/validateuser.tpl'):'WHMCS email-validation modal from twenty-one',
 ('templates/cloudhost247','includes/verifyemail.tpl'):'WHMCS email-verification prompt from twenty-one',
 ('templates/orderforms/ovh_cart','usagebillingpricing.tpl'):'usage-billing pricing partial from the standard_cart parent',
 ('templates/orderforms/ovh_cart','orderforms/standard_cart/common.tpl'):'standard_cart order-form frame from the declared parent',
 ('templates/orderforms/ovh_cart','orderforms/standard_cart/sidebar-categories.tpl'):'standard_cart category sidebar from the declared parent',
 ('templates/orderforms/ovh_cart','orderforms/standard_cart/sidebar-categories-collapsed.tpl'):'standard_cart collapsed category sidebar from the declared parent',
}
def theme_templates():
 """Every child theme this rebuild owns: its directory, the parent it declares, and the templates it ships.

 theme.yaml is the only place the parent is stated, so it is read rather than restated in Python. A
 theme with no `parent:` key ships every template it includes, and the check requires that of it.

 The `*_legacy` order-form tree is left out for the same reason `check-links.mjs` reports the
 vendor-era surfaces instead of fixing them: it is retained unmodified for compatibility, so its
 includes reference cart templates that only exist inside a WHMCS installation. Enforcing it here
 would only add exemptions for a tree nobody changes; enforcing the rebuilt themes is the point."""
 out=[]
 for spec in sorted(ROOT.glob('templates/**/theme.yaml')):
  theme=spec.parent
  if theme.name.endswith('_legacy'):continue
  declared=re.search(r'^\s*parent:\s*([\w.-]+)\s*$',spec.read_text(),re.M)
  files={p.relative_to(theme).as_posix():p.read_text() for p in sorted(theme.rglob('*.tpl'))}
  out.append((theme.relative_to(ROOT).as_posix(),declared.group(1) if declared else '',files))
 return out
def include_targets(text):
 """Literal `{include file=…}` values in one template, in source order.

 A dynamic include (`{include file=$legalTemplate}`) is returned with its leading `$` so the caller can
 skip it: what it resolves to is decided at render time by the data, and guessing would be a false
 alarm. A value that is still assembled from a Smarty expression at render time
 (`orderforms/{$carttpl}/common.tpl`) is skipped for the same reason, not reported. Everything else
 is a path this check can hold to account."""
 return [next(g for g in groups if g) for groups in re.findall(r'\{include\s+file=(?:"([^"]*)"|\'([^\']*)\'|([^}\s]+))',text)
         if not re.search(r'[{}]',''.join(groups))]
def include_errors(themes=None):
 """Every template a first-party theme includes must be one it ships, or a declared parent's.

 Three failure modes, all of them invisible until a page renders: an include neither shipped nor
 covered by the parent's declaration (a removed partial, a typo, a theme whose parent changed); a
 first-party include that no longer exists on disk; and an exemption that has gone stale — the theme
 now ships the template, or nothing includes it any more. A stale exemption is reported rather than
 tolerated because it is how a gate stops covering what it was written for."""
 errors=[];audited=0;used=set();seen=set()
 for directory,parent,files in (themes if themes is not None else theme_templates()):
  seen.add(directory)
  for rel,text in sorted(files.items()):
   for value in include_targets(text):
    audited+=1
    where=directory+'/'+rel
    if value.startswith('$template/'):
     target=value[len('$template/'):];key=(directory,target)
     if target in files:continue
     if key in PARENT_TEMPLATES:
      if not parent:errors.append(where+': includes '+value+', but the theme declares no parent to supply it')
      else:used.add(key)
      continue
     errors.append(where+': includes '+value+', which the theme does not ship and no parent declaration covers')
    elif value.startswith('$'):continue
    elif (ROOT/'templates'/value).is_file() or (ROOT/directory/value).is_file():continue
    elif (directory,value) in PARENT_TEMPLATES and parent:used.add((directory,value))
    else:errors.append(where+': includes '+value+', which does not exist')
 for key,reason in sorted(PARENT_TEMPLATES.items()):
  if key[0] not in seen:
   errors.append(key[0]+': exemption for '+key[1]+' names a theme directory that does not exist')
  elif key[1] in dict((d,f) for d,_,f in themes or theme_templates())[key[0]]:
   errors.append(key[0]+': the exemption for '+key[1]+' is stale - the theme now ships it')
  elif key not in used:
   errors.append(key[0]+': the exemption for '+key[1]+' is stale - nothing includes it any more ('+reason+')')
 return errors,audited
# Filled in by validate() so the report can state how much of the theme it covered.
AUDITED={}
def validate(data):
 errors=[];links=[]
 for menu in data['navigation']:
  for group in menu['groups']:links+=group['links']
 for group in data['footer']:links+=group['links']
 for link in links:
  url=link.get('url','');p=urllib.parse.urlsplit(url)
  if not url or url.startswith('#') or p.scheme or p.netloc or '..' in p.path.split('/') or p.path.startswith('/'):
   errors.append('Unsafe/placeholder navigation URL: '+repr(url));continue
  if not route_exists(p.path):errors.append('Missing navigation route: '+url)
  if p.path=='dedeicated-server.php':errors.append('Navigation must use canonical dedicated-server.php')
  if not link.get('label','').strip():errors.append('Empty navigation label: '+url)
 # Per-page metadata is present and unique.
 #
 # Duplicated metadata is invisible on a single page and obvious in a result list, where two pages
 # sharing a title or a description read as the same page twice. The effective description is the
 # authored `seo_description` where one exists and the page's `summary` otherwise — the same
 # fallback the theme applies at render time — so both fields are checked, not just one.
 titles={};descriptions={}
 for path,page in data['pages'].items():
  if not (ROOT/path).is_file():errors.append('Missing registry route: '+path)
  asset=ROOT/'assets/images/cloudhost247'/(page['visual']+'.svg')
  if not asset.is_file():errors.append('Missing product illustration: '+str(asset))
  for related in page.get('related',[]):
   if related not in data['pages']:errors.append('Unknown related service: '+related)
  title=(page.get('title') or '').strip();description=(page.get('seo_description') or page.get('summary') or '').strip()
  if not title:errors.append('Published page has no title: '+path)
  if not description:errors.append('Published page has no meta description: '+path)
  for value,seen,label in ((title,titles,'title'),(description,descriptions,'description')):
   if not value:continue
   if value in seen:errors.append(f'Duplicated page {label}: {seen[value]} and {path}')
   else:seen[value]=path
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
 # Presentation contract: a template may only render classes a stylesheet it loads actually defines.
 undefined_classes,classes_audited=class_errors();errors+=undefined_classes;AUDITED['classes']=classes_audited
 # Every `{include}` a theme makes resolves to a template, and to the right kind of owner.
 parent_includes,includes_audited=include_errors();errors+=parent_includes;AUDITED['includes']=includes_audited
 errors+=palette_errors()
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
 data=json.loads(CATALOG.read_text());errors,urls=validate(data);result={'registry_pages':len(data['pages']),'navigation_destinations':len(urls),'classes_audited':AUDITED.get('classes',0),'includes_audited':AUDITED.get('includes',0),'source_errors':errors.copy(),'http':'not run; WHMCS staging required'}
 if args.base:
  targets=sorted(set(list(data['pages'])+[u for u in urls if not u.startswith(('logout.php','cart.php','clientarea.php'))]))
  remote,responses=http_check(args.base,targets);errors+=remote;result['http']=responses;result['http_errors']=remote
 result['passed']=not errors
 if args.output:Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2));sys.exit(1 if errors else 0)
