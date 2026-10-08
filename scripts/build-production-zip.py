#!/usr/bin/env python3
"""Build the CloudHost247 production archive.

What goes in:

  * the WHMCS deployment (root PHP pages, `templates/`, `modules/`, `crons/`, `lang/`, `config/`);
  * the CloudHost247 Node platform (compiled `dist/`, `database/`, `manifests/`, `scripts/`);
  * the built public website (`cloudhost247-node/public`: SPA bundle, `/media/`, `/docs/*.md`);
  * the shared registry and generated content, so the archive can regenerate its own navigation;
  * configuration *templates* (`.env.example`) and the deployment guide.

What stays out:

  * `.git`, `node_modules`, caches, build scratch, test fixtures;
  * anything matching the secret patterns below — a match is reported and skipped, never shipped;
  * `dist/` of the repository root (this script's own output directory).

Usage:

    python3 scripts/build-production-zip.py [--version 1.0.0] [--out /path/to/archive.zip]
                                            [--skip-build] [--verify]

`--verify` extracts the finished archive into a clean temporary directory and checks that the
deployment it describes is actually complete: entry points present, configuration templates
present, every asset the website references present, and no secret material inside.
"""
import argparse
import os
import re
import shutil
import subprocess
import json
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VERSION = '1.0.0'

SKIP_DIRS = {
    '.git', '.github', 'node_modules', '.cache', 'templates_c', 'attachments',
    'downloads', '__pycache__', '.pytest_cache', '.install-lock', 'coverage', '.vite',
    '.turbo', '.next', 'test-results', 'playwright-report',
    # `platform/` is a parallel implementation of the same product — its own Node monolith, its own
    # public website in platform/public/ and its own colour tokens. The live website is
    # cloudhost247-node (see docs/website-rebuild/GLOBAL-AUDIT.md §"Parallel surfaces"), and
    # shipping a second, visually different public site inside one deployment is exactly the
    # duplication this rebuild exists to remove. It stays in the repository, out of the package,
    # until a decision is made about which platform is the product.
    'platform',
}
SKIP_FILES = {'.env', 'configuration.php', 'overrides.json', 'package-lock.json'}
# Dotfiles are excluded wholesale except for the ones a deployment genuinely needs.
ALLOWED_DOTFILES = {'.env.example', '.htaccess'}
# Real key material only. Documentation placeholders and test assertions are not secrets.
SECRET = re.compile(
    r'(AKIA[0-9A-Z]{16}'
    r'|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[A-Za-z0-9+/=\s]{80,}'
    r'|WHMCS_[A-Z0-9_]*LICENSE\s*=\s*\S{8,}'
    r'|sk_live_[0-9a-zA-Z]{20,}'
    # A database URL with an embedded literal password. Template files legitimately contain
    # `postgres://user:${POSTGRES_PASSWORD}@host` or `postgres://user:__DB_PASSWORD__@host`, and
    # treating those as secrets would strip working configuration out of the archive — so any URL
    # containing a variable reference, or a placeholder-looking password, is not a secret.
    r'|(?:postgres|mysql)://(?![^\s\'"@]*[$][{])(?![^\s\'"@]*__)'
    r'[^\s:\'"]+:(?![\w*_.-]*(?i:password|changeme|example|secret|your|placeholder|pass))'
    r'[^\s@\'"]{8,}@)'
)

# Paths that must exist for the archive to be deployable at all.
REQUIRED = [
    'README.md',
    'web-hosting.php',
    'cloudhost247-node/package.json',
    'cloudhost247-node/server.js',
    'cloudhost247-node/.env.example',
    'cloudhost247-node/dist/src/app.js',
    'cloudhost247-node/public/index.html',
    'cloudhost247-node/public/media/cloudhost247/brand/logo-horizontal-dark.svg',
    'shared/site/registry.json',
    'shared/site/design-system.css',
    'templates/cloudhost247/css/design-system.css',
    'templates/cloudhost247/includes/site-nav.tpl',
    'templates/cloudhost247/includes/site-footer.tpl',
    'modules/addons/cloudhost247_theme/resources/site.json',
    'scripts/site/generate.mjs',
    'scripts/site/check-links.mjs',
]


def skip(rel: Path) -> bool:
    if set(rel.parts) & SKIP_DIRS:
        return True
    if rel.name in SKIP_FILES or rel.name.startswith('.env') and rel.name != '.env.example':
        return True
    if rel.suffix in {'.zip', '.pem', '.key'} or rel.name.endswith('.pyc'):
        return True
    if 'php-wasm' in rel.parts and 'node_modules' in rel.parts:
        return True
    # The repository root's own dist/ holds this script's output.
    if rel.parts[:1] == ('dist',):
        return True
    return False


def build_application(log) -> None:
    npm = shutil.which('npm')
    if npm is None:
        log('npm not found — skipping the application build (--skip-build implies this)')
        return
    for script, where in (('build:server', ROOT / 'cloudhost247-node'), ('build:frontend', ROOT / 'cloudhost247-node')):
        log(f'running npm run {script}')
        result = subprocess.run([npm, 'run', script], cwd=where, capture_output=True, text=True)
        if result.returncode != 0:
            sys.stderr.write(result.stdout[-4000:] + result.stderr[-4000:])
            raise SystemExit(f'build step {script} failed')


def write_manifest(archive: zipfile.ZipFile, version: str, count: int) -> None:
    import datetime
    manifest = f"""CloudHost247 production package
==============================

Version:   {version}
Built:     {datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}
Files:     {count}

Contents
--------
* WHMCS deployment      root *.php pages, templates/, modules/, crons/, lang/, config/
  -> Deploy by copying this archive's contents into an existing WHMCS document root.
     WHMCS core (init.php, includes/, vendor/, assets/) is NOT included: this repository
     contains the customisations only, exactly as the README describes.

* CloudHost247 platform cloudhost247-node/  (compiled dist/, database/, manifests/, scripts/)
  -> Deploy per cloudhost247-node/DEPLOYMENT_GUIDE.md. Copy .env.example to .env and fill it in;
     no credential is shipped in this archive.

* Public website        cloudhost247-node/public/  (built SPA, /media illustrations, /docs/*.md)
  -> Served by the platform; it is also valid static output if fronted by a web server that
     rewrites unknown paths to index.html.

* Shared registry       shared/site/  (registry.json, design-system.css, content/, generated/)
  -> Single source of truth for navigation, footer, page content and the design system.
     Regenerate with:  node scripts/site/generate.mjs
     Verify links with: node scripts/site/check-links.mjs

Verification
------------
    python3 scripts/build-production-zip.py --verify

This confirms the entry points, configuration templates, referenced assets and the absence of
secret material. It does not start the applications: run the platform's own test suite
(`cd cloudhost247-node && npm test`) against a staging environment before going live.
"""
    archive.writestr('PRODUCTION-MANIFEST.txt', manifest)


def verify(archive_path: Path, log) -> int:
    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        destination = Path(tmp) / 'extract'
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            bad = archive.testzip()
            if bad is not None:
                failures.append(f'corrupt member in archive: {bad}')
            archive.extractall(destination)

        for required in REQUIRED:
            if not (destination / required).exists():
                failures.append(f'missing required file: {required}')

        # Every illustration the website references must be inside the archive.
        #
        # Counting files is not the same check. A build whose `public/media` is one generation
        # behind still has a media directory and still passes a count — it is simply missing the
        # pages' artwork, which is exactly how a product page ships with a broken image. So each
        # visual the theme registry names is resolved by name, against both the built SPA tree and
        # the PHP theme's own copy of the library.
        media = destination / 'cloudhost247-node' / 'public' / 'media' / 'cloudhost247'
        if media.is_dir():
            log(f'media assets present: {sum(1 for _ in media.rglob("*") if _.is_file())}')
        else:
            failures.append('the built website has no media asset directory')

        theme_registry = destination / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / 'site.json'
        if not theme_registry.is_file():
            failures.append('the PHP theme registry is not in the archive; the website cannot be served')
        else:
            try:
                pages = json.loads(theme_registry.read_text()).get('pages', {})
            except (OSError, ValueError):
                pages = {}
                failures.append('the PHP theme registry in the archive is not readable JSON')
            wanted = set()
            # The 3D scenes are the other half of the illustration contract. A page names the
            # scene and the template turns it into a srcset, so a scene that is present as a
            # JPEG but missing an encoding is a broken image rather than a slow one: a <source>
            # whose URL 404s does not fall through to the next source. `visual.tpl` and
            # `Illustration.tsx` advertise these three widths literally and
            # `scripts/generate-raster-formats.py` writes them; the names are repeated here so
            # this check is an independent reading of the archive rather than a shared constant.
            scenes = set()
            for page in pages.values():
                if page.get('visual'):
                    wanted.add(page['visual'])
                if page.get('visual3d'):
                    scenes.add(page['visual3d'])
                for section in page.get('sections', []) or []:
                    if section.get('visual'):
                        wanted.add(section['visual'])
                    if section.get('visual3d'):
                        scenes.add(section['visual3d'])
            roots = [
                ('built SPA', media),
                ('PHP theme', destination / 'assets' / 'images' / 'cloudhost247'),
            ]
            for label, root in roots:
                if not root.is_dir():
                    failures.append(f'the {label} illustration library is missing from the archive')
                    continue
                absent = sorted(visual for visual in wanted if not (root / f'{visual}.svg').is_file())
                if absent:
                    failures.append(
                        f'{len(absent)} illustration(s) referenced by the theme registry are missing from the '
                        f'{label} library: ' + ', '.join(absent[:8]) + (' …' if len(absent) > 8 else '')
                    )
                unencodable = sorted(
                    f'{scene}{suffix}'
                    for scene in scenes
                    for suffix in ['.jpg', *[f'-{width}.{fmt}' for width in (640, 960, 1280)
                                             for fmt in ('avif', 'webp')]]
                    if not (root / f'{scene}{suffix}').is_file()
                )
                if unencodable:
                    failures.append(
                        f'{len(unencodable)} 3D scene encoding(s) missing from the {label} library: '
                        + ', '.join(unencodable[:8]) + (' …' if len(unencodable) > 8 else '')
                    )
            log(f'theme illustrations resolved: {len(wanted)} · 3D scenes: {len(scenes)}')

        # The public documentation the reader fetches must be present, and must be *exactly* the
        # published set. A stale build directory is how an internal document stays downloadable
        # after it is unpublished, so the packaged files are compared against the generated index
        # (which is itself part of the archive) instead of only being counted.
        docs = destination / 'cloudhost247-node' / 'public' / 'docs'
        md_count = len(list(docs.glob('*.md'))) if docs.is_dir() else 0
        if md_count < 5:
            failures.append(f'only {md_count} documentation files were packaged')
        log(f'published documentation files: {md_count}')

        index_path = destination / 'cloudhost247-node' / 'frontend' / 'src' / 'content' / 'docs.generated.json'
        if index_path.is_file():
            try:
                index = json.loads(index_path.read_text())
                documents = index.get('documents') if isinstance(index, dict) else index
                published = {f"{entry['slug']}.md" for entry in documents if isinstance(entry, dict)}
            except (OSError, ValueError, KeyError, TypeError):
                published = set()
                failures.append('the generated documentation index could not be read from the archive')
            if published:
                for directory in (
                    destination / 'cloudhost247-node' / 'public' / 'docs',
                    destination / 'assets' / 'cloudhost247-tools' / 'docs',
                ):
                    if not directory.is_dir():
                        continue
                    packaged = {path.name for path in directory.glob('*.md')}
                    stale = sorted(packaged - published)
                    missing = sorted(published - packaged)
                    if stale:
                        failures.append(f'de-published documentation left in {directory.relative_to(destination)}: ' + ', '.join(stale))
                    if missing:
                        failures.append(f'published documentation missing from {directory.relative_to(destination)}: ' + ', '.join(missing))

        # No secret material anywhere in the archive.
        for name in names:
            if name.endswith('/'):
                continue
            path = destination / name
            if path.stat().st_size > 2_000_000 or path.suffix not in {'.php', '.js', '.json', '.tpl', '.py', '.md', '.txt', '.yml', '.yaml', '.css', '.ts', '.tsx'}:
                continue
            try:
                text = path.read_text(errors='ignore')
            except OSError:
                continue
            if SECRET.search(text):
                failures.append(f'possible secret material in {name}')

        log(f'archive members: {len(names)}')
        log(f'archive size: {archive_path.stat().st_size / 1024 / 1024:.1f} MB')

    if failures:
        sys.stderr.write('\n✖ production archive verification failed:\n')
        for failure in failures:
            sys.stderr.write(f'  - {failure}\n')
        return 1
    log('✓ production archive verified: deployable, complete, no secret material')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default=DEFAULT_VERSION)
    parser.add_argument('--out', default=None, help='output path (default: ../CloudHost247-release/)')
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()

    out = Path(args.out) if args.out else (ROOT.parent / 'CloudHost247-release' / f'CloudHost247-production-{args.version}.zip')
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    def log(message: str) -> None:
        print(message, flush=True)

    if not args.skip_build:
        build_application(log)

    hits = []
    count = 0
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS and not name.startswith('.')]
            for name in filenames:
                path = Path(dirpath) / name
                rel = path.relative_to(ROOT)
                if skip(rel) or (name.startswith('.') and name not in ALLOWED_DOTFILES):
                    continue
                if path.stat().st_size < 2_000_000 and path.suffix in {
                    '.php', '.js', '.json', '.tpl', '.py', '.md', '.txt', '.yml', '.yaml', '.css', '.ts', '.tsx'
                }:
                    try:
                        text = path.read_text(errors='ignore')
                    except OSError:
                        text = ''
                    if SECRET.search(text):
                        hits.append(str(rel))
                        continue
                archive.write(path, rel.as_posix())
                count += 1
        write_manifest(archive, args.version, count)

    log(f'wrote {out} files={count + 1} bytes={out.stat().st_size} secret_skipped={len(hits)}')
    for hit in hits:
        log(f'secret-skipped {hit}')

    if args.verify:
        return verify(out, log)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
