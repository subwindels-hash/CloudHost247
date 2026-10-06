#!/usr/bin/env python3
"""Build a production archive. Excludes VCS, secrets, caches and dependencies."""
import os
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'cloudhost247-production.zip'
SKIP_DIRS = {
    '.git', '.github', 'node_modules', '.cache', 'templates_c', 'attachments',
    'downloads', '__pycache__', '.pytest_cache', '.install-lock', 'dist',
}
SKIP_FILES = {
    '.env', 'configuration.php', 'overrides.json',
}
# Real key material only. Documentation placeholders and test assertions are not secrets.
SECRET = re.compile(r'(AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[A-Za-z0-9+/=\s]{80,}|WHMCS_[A-Z0-9_]*LICENSE\s*=\s*\S{8,})')

def skip(path: Path) -> bool:
    parts = set(path.parts)
    if parts & SKIP_DIRS:
        return True
    if path.name in SKIP_FILES or path.name.startswith('.env'):
        return True
    if path.suffix in {'.zip', '.pem', '.key'} or path.name.endswith('.pyc'):
        return True
    if 'php-wasm' in parts and 'node_modules' in parts:
        return True
    return False

def main():
    OUT.parent.mkdir(exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    hits = []
    count = 0
    with zipfile.ZipFile(OUT, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS and not name.startswith('.')]
            for name in filenames:
                path = Path(dirpath) / name
                rel = path.relative_to(ROOT)
                if skip(rel) or (name.startswith('.') and name != '.htaccess'):
                    continue
                if path.stat().st_size < 2_000_000 and path.suffix in {'.php', '.js', '.json', '.env', '.tpl', '.py', '.md', '.txt', '.yml', '.yaml'}:
                    try:
                        text = path.read_text(errors='ignore')
                    except OSError:
                        text = ''
                    if SECRET.search(text):
                        hits.append(str(rel))
                        continue
                archive.write(path, rel.as_posix())
                count += 1
    print(f'wrote {OUT} files={count} bytes={OUT.stat().st_size} secret_skipped={len(hits)}')
    for hit in hits:
        print('secret-skipped', hit)

if __name__ == '__main__':
    main()
