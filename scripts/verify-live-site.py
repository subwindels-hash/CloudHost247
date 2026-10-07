#!/usr/bin/env python3
"""Prove which build the live CloudHost247 website is actually serving.

Why this exists
---------------
The public website is served by the Node platform (`cloudhost247-node/`), not by the WHMCS/PHP
theme. Those are two different deployments of two different websites, and updating one never
changes the other. A deployment that "did not change anything" is therefore almost always a
deployment that uploaded the right code to the wrong surface, or uploaded an old package to the
right one -- see `docs/website-rebuild/LIVE-SITE-DEPLOYMENT.md`.

Every check below is a property the rebuilt site has and the pre-rebuild build (the October 4
`cloudhost247-cpanel-b7a2af3` package, and every build before PR #61) did not. Running this after
an upload answers one question: *is the live host serving this repository's website yet?*

Two results are deliberately reported separately from that verdict, because they are real problems
that are nonetheless not "the deployment did not land":

  * `WARN database-reachable` -- the app is up but cannot reach PostgreSQL. Marketing pages render
    without a database, so the rebuild can be live while this is still broken; migrations cannot run
    until it is fixed. Diagnose with `npm run db:doctor` (see LIVE-SITE-DEPLOYMENT.md §0).
  * `WARN no-stale-build-copy` -- the rebuild is live but the *pre-rebuild* entry chunk is still
    being served, which means a stale copy of the old SPA exists in the domain's document root or in
    a CDN cache (LIVE-SITE-DEPLOYMENT.md §3.7, item 2).
  * `WARN tool-catalogue-answers` -- the catalogue endpoint answers JSON and reports itself
    degraded, i.e. the database is still unreachable. The catalogue is static and stays usable, so
    this is a database problem, not a deployment problem. If the endpoint answers with HTML instead,
    that is a FAIL: something other than the API is answering that path, which is exactly the state
    that produced "Tools are temporarily unavailable. Unexpected token '<' ..." on every tool page
    (LIVE-SITE-DEPLOYMENT.md §0.1).

It is read-only: GET requests to public URLs. It never authenticates and never mutates anything.

Usage
-----
    python3 scripts/verify-live-site.py
    python3 scripts/verify-live-site.py --base https://rent.windelsai.com/
    python3 scripts/verify-live-site.py --local cloudhost247-node/public --json live-report.json

Exit code is 0 only when every check passes.
"""
import argparse
import html as html_module
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# The pre-rebuild document shell (release/cloudhost247-cpanel-b7a2af3.zip, built 2026-10-04). Its
# presence means the deployment predates the website rebuild regardless of what else answers.
STALE_TITLES = {
    'CloudHost247 — Cloud hosting, built for your next idea',
    'CloudHost247 - Cloud hosting, built for your next idea',
}
# The rebuilt shell, committed in cloudhost247-node/frontend/index.html.
EXPECTED_TITLE = 'CloudHost247 — Hosting, Cloud, Domains & Developer Platform'
# The entry chunk of the pre-rebuild build (release/cloudhost247-cpanel-b7a2af3.zip, 2026-10-04).
# Once the Node application is replaced, that file cannot be served by the application any more --
# so if the rebuilt build IS live and this file still answers 200, something else is serving it:
# a stale copy of the old SPA in the domain's document root, or a CDN cache.
STALE_ENTRY = '/assets/index-Ti2UwGlH.js'

UA = {'User-Agent': 'CloudHost247-deployment-verifier/1.0 (+scripts/verify-live-site.py)'}


def fetch(url, timeout=20):
    """GET a URL. Returns (status, body_text, headers); never raises for HTTP status codes."""
    request = urllib.request.Request(url, headers=UA, method='GET')
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode('utf-8', 'replace')
            return response.status, body, dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode('utf-8', 'replace'), dict(exc.headers or {})
    except Exception as exc:  # DNS, TLS, connection refused, timeout
        return None, f'{type(exc).__name__}: {exc}', {}


def local_entry_bundle(public_dir):
    """Entry asset filename from the locally built shell, so a build can be identified exactly."""
    index = Path(public_dir) / 'index.html'
    if not index.is_file():
        return None
    match = re.search(r'src="([^"]*assets/index-[^"]+\.js)"', index.read_text(encoding='utf-8'))
    return match.group(1) if match else None


def strip_comments(html):
    """Remove HTML comments before parsing.

    Not cosmetic: the pre-rebuild shell's own comment mentions `<title>/description`, and an
    un-stripped `<title>` there makes a naive parse read the comment as the page title.
    """
    return re.sub(r'<!--.*?-->', '', html, flags=re.S)


def title_of(html):
    """The <title> text, entity-decoded so `&amp;` compares equal to `&`."""
    match = re.search(r'<title[^>]*>(.*?)</title>', strip_comments(html), re.S | re.I)
    return html_module.unescape(match.group(1).strip()) if match else None


def entry_of(html):
    match = re.search(r'src="(/assets/index-[^"]+\.js)"', strip_comments(html))
    return match.group(1) if match else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base', default='https://rent.windelsai.com/',
                        help='Base URL of the deployed site (default: %(default)s)')
    parser.add_argument('--local', default=str(ROOT / 'cloudhost247-node' / 'public'),
                        help='Locally built public/ directory to compare against (default: %(default)s)')
    parser.add_argument('--json', dest='json_out', help='Write the machine-readable report here')
    args = parser.parse_args()

    base = args.base if args.base.endswith('/') else args.base + '/'
    checks = []

    def add(name, ok, detail, warn=False):
        """Record a check. `warn=True` reports a problem that is not the deployment question
        (e.g. the database being unreachable) and does not change the rebuild verdict."""
        checks.append({'check': name, 'ok': bool(ok), 'warn': bool(warn), 'detail': detail})
        return ok

    # 1. The Node application answers at all.
    status, body, _ = fetch(base + 'health')
    add('node-app-answers', status == 200 and '"status"' in body,
        f'GET /health -> {status} {body.strip()[:80]}')

    # 2. The document shell is the rebuilt one, not the pre-rebuild shell.
    status, html, _ = fetch(base)
    live_title = title_of(html)
    stale = live_title in STALE_TITLES
    add('document-shell-is-rebuilt', status == 200 and live_title == EXPECTED_TITLE and not stale,
        f'live <title> = {live_title!r}' + ('  <-- PRE-REBUILD BUILD IS DEPLOYED' if stale else ''))

    # 3. The entry bundle the live HTML points at is the one this checkout builds.
    expected_entry = local_entry_bundle(args.local)
    live_entry = entry_of(html)
    if expected_entry:
        add('entry-bundle-matches-checkout', live_entry == expected_entry,
            f'live {live_entry!r} vs local {expected_entry!r}')
    else:
        add('entry-bundle-matches-checkout', bool(live_entry),
            f'live {live_entry!r}; no local build at {args.local} to compare against')
    if live_entry:
        status, _, _ = fetch(base + live_entry.lstrip('/'))
        add('entry-bundle-is-served', status == 200, f'GET {live_entry} -> {status}')

    # 3b. Only meaningful once the rebuild is live: if the *old* entry chunk is still served, a
    #     stale copy of the pre-rebuild SPA exists outside the Node application. That is the one
    #     failure that survives a correct upload -- route through LIVE-SITE-DEPLOYMENT.md §3.7.
    if live_entry == expected_entry:
        status, _, _ = fetch(base + STALE_ENTRY.lstrip('/'))
        add('no-stale-build-copy', status != 200,
            f'GET {STALE_ENTRY} -> {status}'
            + ('' if status != 200 else '  <-- the pre-rebuild bundle is still served; a stale copy '
                                        'of the old site exists in the document root or a CDN'),
            warn=(status == 200))

    # 4. The registry-driven navigation API -- added by the rebuild, absent before it.
    status, body, _ = fetch(base + 'api/v1/navigation')
    ok = status == 200 and '"sections"' in body
    add('navigation-api-present', ok, f'GET /api/v1/navigation -> {status} {body.strip()[:80]}')

    # 5. The server-rendered sitemap -- the rebuilt platform serves it, the old build 404s it.
    status, body, _ = fetch(base + 'sitemap.xml')
    add('server-rendered-sitemap', status == 200 and body.lstrip().startswith('<?xml'),
        f'GET /sitemap.xml -> {status} ({len(body)} bytes)')

    # 6. robots.txt is generated with an absolute Sitemap directive.
    status, body, _ = fetch(base + 'robots.txt')
    add('robots-advertises-sitemap', status == 200 and 'Sitemap:' in body,
        f'GET /robots.txt -> {status}; "Sitemap:" line {"present" if "Sitemap:" in body else "MISSING"}')

    # 7. The rebuild's media tree is on disk. A 404 here means public/media/ was never uploaded --
    #    the single clearest signal that the old package is still deployed.
    media = 'media/cloudhost247/brand/icon-mark.svg'
    status, _, _ = fetch(base + media)
    add('media-tree-deployed', status == 200, f'GET /{media} -> {status}')

    # 8. Deployment health, kept OUT of the rebuild verdict: every marketing page renders from the
    #    compiled bundle and never queries the database, so the design change appears even while the
    #    database is unreachable -- but the catalogue, pricing, domain and account surfaces then
    #    answer with their error/empty states, and `migrate up` cannot run at all.
    status, body, _ = fetch(base + 'ready')
    db_ok = status == 200 and '"status":"ok"' in body.replace(' ', '')
    add('database-reachable', db_ok,
        f'GET /ready -> {status} {body.strip()[:90]}'
        + ('' if db_ok else '  <-- catalogue/account pages will show error states and migrations cannot run'),
        warn=True)

    # 9. The tool catalogue answers with JSON. This is the check for the report that every Tool
    #    Center page said "Tools are temporarily unavailable. Unexpected token '<', "<!doctype "...
    #    is not valid JSON": that message can only come from a body that is HTML, i.e. the API path
    #    was answered by something that is not the API (a static copy of the SPA falling back to
    #    index.html with HTTP 200, which `res.ok` cannot see). The catalogue is a static document
    #    compiled into the app, so it must answer JSON even when the database is down -- in that
    #    case with `"degraded": true` and the reason, which is reported as a WARN, not a FAIL.
    status, body, headers = fetch(base + 'api/tools/catalog')
    content_type = next((v for k, v in headers.items() if k.lower() == 'content-type'), '')
    is_json = False
    try:
        payload = json.loads(body)
        is_json = isinstance(payload, dict) and payload.get('success') is True and 'tools' in payload
    except (ValueError, TypeError):
        payload = None
    looks_html = body.lstrip()[:15].lower().startswith(('<!doctype', '<html'))
    if not is_json:
        add('tool-catalogue-answers', False,
            f'GET /api/tools/catalog -> {status} {content_type or "?"}; '
            + ('an HTML page came back, so something other than the API answered that path '
               '(tool pages will show a parser error)' if looks_html
               else f'not the expected JSON: {body.strip()[:80]}'))
    else:
        degraded = bool(payload.get('degraded'))
        reason = (payload.get('degradedReason') or '').strip()
        add('tool-catalogue-answers', not degraded,
            f'GET /api/tools/catalog -> {status}, {len(payload.get("tools") or [])} tools'
            + (f', degraded: {reason[:100]}' if degraded else ''),
            warn=degraded)

    failed = [c for c in checks if not c['ok'] and not c['warn']]
    warnings = [c for c in checks if not c['ok'] and c['warn']]
    report = {
        'base': base,
        'passed': not failed,
        'checks': checks,
        'warnings': warnings,
        'expected_entry_bundle': expected_entry,
        'live_entry_bundle': live_entry,
        'live_title': live_title,
    }

    width = max(len(c['check']) for c in checks)
    print(f'CloudHost247 live deployment verification — {base}\n')
    for check in checks:
        label = 'PASS' if check['ok'] else ('WARN' if check['warn'] else 'FAIL')
        print(f"  {label:<4}  {check['check']:<{width}}  {check['detail']}")
    print()
    if failed:
        print(f'{len(failed)} of {len(checks)} checks failed. The live host is NOT serving this '
              f"repository's website.\n")
        print('Fix: build and upload the Node platform package, then restart the application --')
        print('  cd cloudhost247-node && bash scripts/package-cpanel.sh')
        print('  # upload release/cloudhost247-cpanel-<sha>.zip into the cPanel app root, extract,')
        print('  # overwrite dist/ and public/, then Restart the application in Setup Node.js App.')
        print('See docs/website-rebuild/LIVE-SITE-DEPLOYMENT.md for the full procedure, the')
        print('migration step, and why uploading the WHMCS/PHP package changes nothing here.')
    elif warnings:
        print(f'The live host IS serving this build. {len(warnings)} non-deployment warning(s) '
              f'remain:')
        for warning in warnings:
            print(f"  - {warning['check']}: {warning['detail']}")
        print('See docs/website-rebuild/LIVE-SITE-DEPLOYMENT.md §0 (the database is a separate,')
        print('older problem from the deployment itself).')
    else:
        print(f'All {len(checks)} checks passed — the live host is serving this build.')

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
