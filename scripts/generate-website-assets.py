#!/usr/bin/env python3
"""Reproducible original Orbit geometry. Raster conversion requires Pillow and a resvg Node adapter (CH247_RASTER_SCRIPT)."""
from pathlib import Path
import json, html, hashlib
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/images/cloudhost247'
for d in ('brand','hero','hosting','cloud','servers','domains','applications','deployment','operating-systems','management','security','blog','icons','social','favicon'):(OUT/d).mkdir(parents=True,exist_ok=True)
def svg(body,w=660,h=560,title='CloudHost247 conceptual infrastructure'):
 return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img"><title>{html.escape(title)}</title>{body}</svg>\n'
def save(path,body,w=660,h=560,title='CloudHost247 conceptual infrastructure'):(OUT/(path+'.svg')).write_text(svg(body,w,h,title))
mark='<path d="M8 27V15L24 6l16 9v12L24 37 8 27Z" fill="none" stroke="COLOR" stroke-width="3" stroke-linejoin="round"/><path d="m8 15 16 10 16-10M24 25v12M16 11l16 10" fill="none" stroke="COLOR" stroke-width="3" stroke-linejoin="round"/>'
for name,color in [('dark','#102332'),('white','#ffffff'),('mono','#000000')]:
 m=mark.replace('COLOR',color)
 save('brand/logo-horizontal-'+name,m+f'<text x="53" y="29" fill="{color}" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" font-weight="600" letter-spacing="-1">CloudHost247</text>',230,44,'CloudHost247')
 save('brand/logo-primary-'+name,f'<g transform="translate(41,0)">{m}</g><text x="65" y="65" text-anchor="middle" fill="{color}" font-family="DejaVu Sans,Arial,sans-serif" font-size="17" font-weight="600" letter-spacing="-.8">CloudHost247</text>',130,78,'CloudHost247')
save('brand/icon-mark','<rect width="48" height="44" rx="10" fill="#101e2c"/>'+mark.replace('COLOR','#b4f2cd'),48,44,'CloudHost247 icon')
save('brand/logo-compact',mark.replace('COLOR','#196947')+'<text x="53" y="29" fill="#102332" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" font-weight="600">CH247</text>',136,44,'CH247')
icons={
 'server':'<rect x="9" y="8" width="30" height="11" rx="3"/><rect x="9" y="25" width="30" height="11" rx="3"/><path d="M15 13h1m6 0h11M15 30h1m6 0h11"/>',
 'web':'<rect x="7" y="9" width="34" height="29" rx="4"/><path d="M7 17h34M12 13h1m4 0h1m-5 11h12m-12 6h21"/>',
 'cloud':'<path d="M14 35h22a8 8 0 0 0 1-16 13 13 0 0 0-25-2 9 9 0 0 0 2 18Z"/><path d="m19 26 5-5 5 5m-5-5v18"/>',
 'code':'<path d="m16 15-10 9 10 9m16-18 10 9-10 9M28 10l-8 28"/>',
 'mail':'<rect x="6" y="11" width="36" height="27" rx="4"/><path d="m7 14 17 13 17-13"/>',
 'domain':'<circle cx="24" cy="24" r="17"/><ellipse cx="24" cy="24" rx="8" ry="17"/><path d="M7 24h34M10 14h28M10 34h28"/>',
 'shield':'<path d="m24 5 16 6v13c0 9-16 18-16 18S8 33 8 24V11l16-6Z"/><path d="m16 24 5 5 11-11"/>',
 'app':'<rect x="7" y="7" width="13" height="13" rx="3"/><rect x="28" y="7" width="13" height="13" rx="3"/><rect x="7" y="28" width="13" height="13" rx="3"/><path d="M28 34h13m-6-6v13"/>',
 'control':'<path d="M9 8v32M24 8v32M39 8v32"/><rect x="5" y="15" width="8" height="8" rx="2" fill="#183646"/><rect x="20" y="28" width="8" height="8" rx="2" fill="#183646"/><rect x="35" y="13" width="8" height="8" rx="2" fill="#183646"/>',
 'user':'<circle cx="24" cy="16" r="8"/><path d="M9 40a15 15 0 0 1 30 0"/>',
 'storage':'<ellipse cx="24" cy="10" rx="17" ry="6"/><path d="M7 10v25c0 8 34 8 34 0V10M7 23c0 8 34 8 34 0"/>',
}
def icon(kind,color='#b4f2cd'):return f'<g fill="none" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{icons[kind]}</g>'
def plate(x,y,label,kind,active=False):
 top='#28483f' if active else '#1b3444';edge='#68b996' if active else '#436272'
 return f'''<g transform="translate({x},{y})"><ellipse cx="0" cy="65" rx="92" ry="32" fill="#08121a" opacity=".45"/>
 <path d="m-80-5 80-45 80 45v40L0 80l-80-45Z" fill="#132b37" stroke="{edge}" stroke-width="1"/>
 <path d="m-80-5 80 45 80-45M0 40v40" fill="none" stroke="{edge}"/>
 <path d="m-80-5 80-45 80 45L0 40Z" fill="{top}" stroke="{edge}"/>
 <path d="m-60 22 27 15m-27-7 15 8" stroke="#6b8b9a" stroke-width="2"/>
 <g transform="translate(-24,-27)">{icon(kind)}</g><circle cx="53" cy="30" r="3" fill="#b4f2cd"/>
 <text x="0" y="109" text-anchor="middle" fill="#b2c8d2" font-size="10" font-family="DejaVu Sans,Arial,sans-serif" letter-spacing="1.4">{html.escape(label.upper())}</text></g>'''
grid='<defs><radialGradient id="glow"><stop stop-color="#266758" stop-opacity=".3"/><stop offset="1" stop-color="#101e2c" stop-opacity="0"/></radialGradient></defs><ellipse cx="345" cy="270" rx="310" ry="265" fill="url(#glow)"/>'
for i in range(9):
 grid+=f'<path d="M{30+i*60} 70 {630-i*15} 460M{30+i*60} 460 {630-i*15} 70" stroke="#365264" stroke-width=".7" opacity=".23"/>'
points=[(130,125,'Domain','domain'),(380,80,'Website','web'),(535,225,'Cloud','cloud'),(300,235,'Application','code'),(135,370,'Server','server'),(425,410,'User','user')]
hero=grid+'<g fill="none" stroke="#74b59c" stroke-width="1.5"><path d="M130 125 245 58 380 80 535 225 425 410 135 370 130 125M130 125 300 235 535 225M300 235 135 370M300 235 425 410" stroke-dasharray="4 6" opacity=".65"/></g>'
for i,(x,y,label,kind) in enumerate(points):hero+=plate(x,y,label,kind,i==3)
save('hero/infrastructure',hero)
# Stylised continents, no asserted data-center markers. Connections are conceptual only.
world=grid+'<g fill="#23414b" stroke="#436473" stroke-width="1.2"><path d="m72 162 55-40 45 10 32-18 55 21 9 28-49 12-16 30-45 16-7 27-36-14-9-42-38-10Z"/><path d="m192 258 46 14 21 39-17 65-29 47-21-30 7-41-29-48Z"/><path d="m296 151 43-21 28 15 43-18 81 10 72 35-6 32-62 10-13 33-47-3-24-40-23 1-7 37-26 17-19-26-32-20-21 14-16-38Z"/><path d="m310 234 49 5 31 34-15 62-26 34-27-30-7-42-28-26Z"/><path d="m477 340 49-14 47 28-12 26-66 7-29-21Z"/></g>'
world+='<g fill="none" stroke="#a7e0c1" opacity=".55"><path d="M95 205Q295 12 551 235M95 205Q225 420 511 358M185 360Q220 155 450 173" stroke-dasharray="4 8"/></g>'
world+=plate(327,240,'Connected infrastructure','cloud',True)+'<text x="330" y="495" text-anchor="middle" fill="#a4b8c3" font-family="DejaVu Sans,Arial,sans-serif" font-size="10" letter-spacing="2">CONCEPTUAL NETWORK · NOT DATA CENTER LOCATIONS</text>'
save('hero/global-network',world,title='Conceptual world connectivity; no data-center location claims')
catalog=json.loads((ROOT/'modules/addons/cloudhost247_theme/resources/site.json').read_text())
visuals={v['visual']:v['title'] for v in catalog['pages'].values()}
visuals.update({'management/backup':'Independent Backups','management/monitoring':'Monitoring','management/firewall':'Firewall','management/dns':'DNS','management/migration':'Migration','cloud/scalability':'Scalability','cloud/performance':'Performance','security/reliability':'Reliability','hosting/reseller-hosting':'Reseller Hosting'})
for path,title in visuals.items():
 if path.startswith('hero/'):continue
 family=path.split('/')[0];kind={'hosting':'web','cloud':'cloud','servers':'server','domains':'domain','applications':'app','deployment':'code','operating-systems':'app','management':'control','security':'shield','blog':'web'}.get(family,'cloud')
 if 'email' in path:kind='mail'
 if 'backup' in path:kind='storage'
 seed=int(hashlib.sha256(path.encode()).hexdigest()[:8],16)
 labels={'hosting':['DOMAIN','WEBSITE','CONTENT'],'cloud':['COMPUTE','NETWORK','STORAGE'],'servers':['COMPUTE','RESOURCES','NETWORK'],'deployment':['SOURCE','APPLICATION','DEPLOY'],'management':['SERVICE','CONTROL','ACCOUNT'],'applications':['APPLICATION','RUNTIME','SERVER'],'operating-systems':['IMAGE','VERSION','PROVIDER'],'security':['DOMAIN','SECURITY','CONNECTION'],'domains':['NAME','DNS','WEBSITE']}.get(family,['IDEA','PROJECT','NEXT STEP'])
 # Product-specific perspective and configuration; no performance or capacity claims.
 x=300+(seed%50);y=210+(seed%35)
 b=grid+f'<g stroke="#79bda1" fill="none" stroke-dasharray="4 7"><path d="M140 130 {x} {y} 490 360M{x} {y} 150 385M140 130 490 360"/></g>'
 b+=plate(140,120,labels[0],'domain' if family=='hosting' else 'app')
 b+=plate(490,345,labels[2],'storage' if family=='cloud' else 'server')
 b+=f'<g transform="translate({x-330},{y-235})">'+plate(330,235,labels[1],kind,True)+'</g>'
 b+=f'<text x="72" y="485" fill="#b4f2cd" font-size="11" font-family="DejaVu Sans,Arial,sans-serif" letter-spacing="2">CH247 / {html.escape(title.upper())}</text>'
 save(path,b,title=title+' conceptual architecture')
for path,p in catalog['pages'].items():
 family=p['visual'].split('/')[0];kind={'hosting':'web','cloud':'cloud','servers':'server','domains':'domain','deployment':'code','management':'control','security':'shield','applications':'app','operating-systems':'app'}.get(family,'cloud')
 if path=='email-hosting.php':kind='mail'
 save('icons/'+p['slug'],'<rect width="48" height="48" rx="10" fill="#ecf5ef"/>'+icon(kind,'#196947'),48,48,p['title'])
for k in icons:save('icons/'+k,icon(k,'#196947'),48,48,k.title())
# Third-party marks are intentionally not bundled; ApplicationLogo uses neutral text badges.
social='<rect width="1200" height="630" fill="#101e2c"/>'+ '<g transform="translate(670,45) scale(.94)">'+hero+'</g>'
social+='<g transform="translate(65,60)">'+mark.replace('COLOR','#b4f2cd')+'<text x="56" y="29" fill="#fff" font-family="DejaVu Sans,Arial,sans-serif" font-size="23">CloudHost247</text></g><text x="65" y="255" fill="#fff" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="74" letter-spacing="-3">Build. Host.</text><text x="65" y="345" fill="#b4f2cd" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="74" letter-spacing="-3">Deploy. Scale.</text><text x="65" y="462" fill="#b8cad5" font-family="DejaVu Sans,Arial,sans-serif" font-size="22">Your ambition. Our infrastructure.</text>'
save('social/cloudhost247-social',social,1200,630,'CloudHost247 — Build. Host. Deploy. Scale.')
try:
 import subprocess, os
 class Raster:
  @staticmethod
  def svg2png(url=None,write_to=None,scale=1,bytestring=None,output_width=None,output_height=None):
   import re, tempfile
   source=Path(url).read_text() if url else bytestring.decode()
   width=output_width or int(re.search(r'width="(\d+)"',source).group(1))*scale
   with tempfile.NamedTemporaryFile(suffix=".svg",mode="w") as f:
    f.write(source);f.flush()
    subprocess.run(["node",os.environ["CH247_RASTER_SCRIPT"],f.name,write_to,str(width)],check=True)
 cairosvg=Raster
 from PIL import Image
 for p in (OUT/'brand').glob('*.svg'):
  png=p.with_suffix('.png');cairosvg.svg2png(url=str(p),write_to=str(png),scale=3)
  im=Image.open(png);im.save(p.with_suffix('.webp'),lossless=True)
 src=(OUT/'brand/icon-mark.svg').read_text().replace('viewBox="0 0 48 44"','viewBox="-5 -7 58 58"')
 for size in (16,32,48,180,192,512):
  name='apple-touch-icon.png' if size==180 else f'favicon-{size}.png'
  cairosvg.svg2png(bytestring=src.encode(),write_to=str(OUT/'favicon'/name),output_width=size,output_height=size)
 Image.open(OUT/'favicon/favicon-512.png').save(OUT/'favicon/favicon.ico',sizes=[(16,16),(32,32),(48,48)])
 cairosvg.svg2png(url=str(OUT/'social/cloudhost247-social.svg'),write_to=str(OUT/'social/cloudhost247-social.png'))
 Image.open(OUT/'social/cloudhost247-social.png').save(OUT/'social/cloudhost247-social.webp',quality=88,method=6)
except ImportError:raise SystemExit('Install Pillow and configure CH247_RASTER_SCRIPT to generate raster variants.')
(OUT/'favicon/site.webmanifest').write_text(json.dumps({'name':'CloudHost247','short_name':'CH247','display':'browser','background_color':'#101e2c','theme_color':'#101e2c','icons':[{'src':'favicon-192.png','sizes':'192x192','type':'image/png'},{'src':'favicon-512.png','sizes':'512x512','type':'image/png'}]},indent=2)+'\n')
print('Original brand library:',len(list(OUT.rglob('*.*'))),'files;',sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file()),'bytes')
