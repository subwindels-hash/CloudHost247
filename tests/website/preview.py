#!/usr/bin/env python3
"""Local visual-test server only. Never exposes PHP sources, credentials or repository files."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import os,urllib.parse,mimetypes
ROOT=Path(__file__).resolve().parents[2]
FIXTURES=Path(os.environ['CH247_FIXTURE_DIR']).resolve()
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  path=urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip('/') or 'index.php'
  fixture=(FIXTURES/(path+'.html')).resolve()
  file=None
  if fixture.is_relative_to(FIXTURES) and fixture.is_file():file=fixture
  elif path.startswith(('assets/images/cloudhost247/','templates/cloudhost247/css/','templates/cloudhost247/js/')):
   candidate=(ROOT/path).resolve()
   if candidate.is_relative_to(ROOT) and candidate.suffix in ('.svg','.png','.webp','.ico','.css','.js','.webmanifest') and candidate.is_file():file=candidate
  if not file:self.send_error(404,'Unavailable in the template fixture harness');return
  self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'application/octet-stream');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(file.read_bytes())
 def log_message(self,*args):pass
print('Template visual QA only — licensed WHMCS runtime is not present.',flush=True)
ThreadingHTTPServer(('0.0.0.0',8080),Handler).serve_forever()
