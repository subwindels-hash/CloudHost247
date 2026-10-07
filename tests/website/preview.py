#!/usr/bin/env python3
"""Local visual-test server only. Never exposes PHP sources, credentials or repository files."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import os,urllib.parse,urllib.request,urllib.error,mimetypes
ROOT=Path(__file__).resolve().parents[2]
FIXTURES=Path(os.environ['CH247_FIXTURE_DIR']).resolve()
class Handler(BaseHTTPRequestHandler):
 def proxy_tools(self):
  # Development harness only: same-origin real Tools API, not mock lookup results.
  if not self.path.startswith('/platform/api/tools/') :return False
  size=int(self.headers.get('Content-Length','0'))
  if size>8*1024*1024:self.send_error(413);return True
  payload=self.rfile.read(size) if size else None
  request=urllib.request.Request('http://127.0.0.1:3000'+self.path[len('/platform'):],data=payload,method=self.command,headers={'Content-Type':self.headers.get('Content-Type','application/json')})
  try:response=urllib.request.urlopen(request,timeout=70)
  except urllib.error.HTTPError as error:response=error
  except Exception:self.send_error(503);return True
  self.send_response(response.status);self.send_header('Content-Type',response.headers.get('Content-Type','application/json'));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(response.read());return True
 def do_POST(self):
  if not self.proxy_tools():self.send_error(405)
 def do_GET(self):
  if self.proxy_tools():return
  path=urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip('/') or 'index.php'
  fixture=(FIXTURES/(path+'.html')).resolve()
  file=None
  if fixture.is_relative_to(FIXTURES) and fixture.is_file():file=fixture
  elif path.startswith(('assets/images/cloudhost247/','assets/cloudhost247-tools/','templates/cloudhost247/css/','templates/cloudhost247/js/')):
   candidate=(ROOT/path).resolve()
   if candidate.is_relative_to(ROOT) and candidate.suffix in ('.svg','.png','.webp','.jpg','.jpeg','.ico','.css','.js','.webmanifest') and candidate.is_file():file=candidate
  if not file:self.send_error(404,'Unavailable in the template fixture harness');return
  self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'application/octet-stream');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(file.read_bytes())
 def log_message(self,*args):pass
print('Template visual QA only — licensed WHMCS runtime is not present.',flush=True)
ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
