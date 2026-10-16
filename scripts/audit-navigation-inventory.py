#!/usr/bin/env python3
"""Canonical public-page inventory and navigation-discovery audit.

Brief §31 asks for one table that answers, for every public page: which PHP file serves
it, what its canonical URL is, what it is called, how it is categorised, where it appears
in the header and the footer, what its SEO metadata looks like, and whether every link to
it resolves. It then asks for five specific defects to be named rather than inferred:

  ORPHANED PAGES              published, but no navigation and no footer reaches them
  MENU LINKS WITHOUT PAGES    a navigation or footer destination with no route behind it
  PAGES WITHOUT NAVIGATION    reachable only from the sitemap, not from any menu
  DANGLING REDIRECTS          a 301 alias whose target is not a page in this inventory
  DUPLICATE CANONICALS        two pages naming one canonical address

`scripts/inventory-website.py` records what files exist. This script records what a
visitor and a crawler can actually reach, and is the artefact the rebuild is reviewed
against. It reads the same registry the generator emits from, so it cannot disagree with
the navigation the site actually ships.

    python3 scripts/audit-navigation-inventory.py [--json PATH] [--strict]

`--strict` exits non-zero when a structural defect is present, so CI can gate on it. The
default run always writes the report and prints a summary.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'shared' / 'site' / 'registry.json'
SITE_JSON = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / 'site.json'
TOOLS_JSON = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / 'tools.json'
TOOLS_PUBLIC = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / 'tools-public.json'
OUT_DIR = ROOT / 'docs' / 'website-rebuild'

# Licensed WHMCS entry points: deployed with the platform, deliberately not vendored here.
WHMCS_ENTRY_POINTS = {
    'index.php', 'cart.php', 'clientarea.php', 'register.php', 'logout.php', 'pwreset.php',
    'contact.php', 'knowledgebase.php', 'submitticket.php', 'serverstatus.php',
    'announcements.php', 'supporttickets.php', 'viewticket.php', 'domainchecker.php',
    'downloads.php', 'upgrade.php', 'affiliates.php', 'account.php',
}

# Which runtime serves each route. This is the field that stops "the page exists" from being read as
# "this repository ships the page": a WHMCS entry point is deployed with the licensed platform and is
# deliberately not vendored here, while a theme page is a file in this tree.
ROUTE_OWNER_THEME = 'cloudhost247-theme'
ROUTE_OWNER_WHMCS = 'whmcs-core'
ROUTE_OWNER_TOOLS = 'tools-front-controller'
ROUTE_OWNER_INTERNAL = 'internal'
ROUTE_OWNER_UNREGISTERED = 'unregistered'

# The checks that cover a route, each run by `scripts/release-candidate-check.sh`, with the command
# that decides it. Named here rather than asserted per row so the report can state *what* was run
# and a reviewer can re-run the same command; a row's `test_status` is then the subset that applies.
TEST_CHECKS = {
    'php-syntax': 'bash scripts/php-lint-targets.sh | xargs -n1 php -l',
    'php-behaviour': 'php tests/website/run.php (and the module suites)',
    'link-integrity': 'node scripts/site/check-links.mjs',
    'website-static': 'python3 -m unittest tests.website.test_static',
    'rendered-fixtures': 'bash scripts/verify-rendered-site.sh',
    'hero-render': 'bash scripts/verify-rendered-site.sh',
    'accessibility-contract': 'python3 scripts/check-accessibility-contract.py',
    'browser-qa': 'node tests/website/browser.cjs (needs a Chromium binary)',
    'staging-functional': 'docs/staging/STAGING_ACCEPTANCE_REPORT.md (needs a licensed WHMCS install)',
}
# Checks that cannot be decided on a machine without the listed prerequisite. Recorded so a green
# local run is never mistaken for a green release.
TEST_CHECK_BLOCKERS = {
    'browser-qa': 'no browser binary in the audit host',
    'staging-functional': 'licensed WHMCS staging installation',
}
# Checks that need neither WHMCS nor a database, so a published theme page is covered by all of them
# the moment the gate runs.
THEME_PAGE_CHECKS = (
    'php-syntax', 'php-behaviour', 'link-integrity', 'website-static',
    'rendered-fixtures', 'hero-render', 'accessibility-contract',
)

# Routes that are intentionally private: not published, not advertised, not crawled.
INTERNAL_SUFFIXES = ('-sample.php',)
INTERNAL_FILES = {
    'builder-page.php', 'builder-sitemap.php', 'cloudhost247-page.php',
    'cloudhost247-sitemap.php', 'notfound.php', 'service-error.php', 'site-search.php',
    'comingsoon.php', 'robots.php', 'all-element-cloudhost247.php', 'future-element.php',
    'tables.php', 'cloudhost247-marketing-track.php', 'tools-sitemap.php',
    'dedeicated-server.php',  # superseded by dedicated-server.php; kept for compatibility only
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def registry():
    return load_json(REGISTRY)


def tool_entries() -> dict[str, dict]:
    """Every `/tools/...` path the front controller answers, keyed by path with no leading slash.

    Each entry carries `surface`, which is what the route *is*:

      * `native` — `Catalog::resolve()` answers it from `tools-public.json`, the JSON projection of
        `config/tools.php`. These render the working tool.
      * `signpost` — the native catalogue does not know the route, so `tools/index.php` falls through
        to `Theme\\ToolsSite::resolve()` and `tools.json` — the projection of the platform catalogue
        (`cloudhost247-node/src/tools/catalog.ts`). It renders an honest noindex page: the tool's
        summary, the sentence that it runs in the platform application, and a link into it.
      * `redirect` — an alias `tools.json` lists under `legacyPaths`. The front controller answers it
        with a 301 to the tool's canonical path, so it is a public URL but not a page of its own:
        `redirect_to` names its target and it is not given a canonical of its own.

    An earlier revision of this audit measured only `Catalog::resolve()`, concluded that about two
    dozen of these routes were unreachable, and marked them `reachable: false`. Both halves were
    wrong: `/tools/business-tools` does answer, and the two `htaccess`-rewritten catalogues overlap
    in ways a single-call probe cannot see. The distinction that survives measurement is working
    page / signpost / redirect — and a route neither catalogue knows is simply absent from this dict.
    """
    resources = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources'
    entries: dict[str, dict] = {
        'tools': {'name': 'All tools', 'summary': 'CloudHost247 online tools', 'category': '',
                  'kind': 'hub', 'surface': 'native'},
    }
    public = resources / 'tools-public.json'
    if public.is_file():
        data = load_json(public)
        for tool in data.get('tools', []):
            if isinstance(tool.get('path'), str):
                entries.setdefault(tool['path'].lstrip('/'), {
                    'name': tool.get('name', ''), 'summary': tool.get('summary', ''),
                    'category': tool.get('category', ''), 'kind': 'tool', 'surface': 'native',
                })
        for slug, label in (data.get('categories') or {}).items():
            entries.setdefault(f'tools/category/{slug}', {
                'name': f'{label} tools', 'summary': 'CloudHost247 tool category',
                'category': slug, 'kind': 'category', 'surface': 'native',
            })
        for collection in data.get('collections', []):
            if isinstance(collection.get('path'), str):
                entries.setdefault(collection['path'].lstrip('/'), {
                    'name': collection.get('name', ''), 'summary': collection.get('summary', ''),
                    'category': collection.get('category', ''), 'kind': 'collection',
                    'surface': 'native',
                })
    # The discovery taxonomy — the nine categories the mega menu, the hub and the sitemaps publish —
    # comes from the registry projection, which is where the PHP shell reads it from too.
    site = resources / 'site.json'
    if site.is_file():
        for category in load_json(site).get('toolCategories', []):
            slug = category.get('slug')
            if slug:
                entries.setdefault(f'tools/category/{slug}', {
                    'name': f"{category.get('label', slug)} tools",
                    'summary': 'CloudHost247 tool category', 'category': slug, 'kind': 'category',
                    'surface': 'native',
                })

    app = resources / 'tools.json'
    if app.is_file():
        data = load_json(app)
        for tool in data.get('tools', []):
            path = tool.get('path')
            if isinstance(path, str):
                route = path.lstrip('/')
                if route not in entries:
                    entries[route] = {
                        'name': tool.get('name', ''), 'summary': tool.get('summary', ''),
                        'category': tool.get('category', ''), 'kind': 'tool', 'surface': 'signpost',
                    }
            # Aliases are resolved to the tool's own path, which is where their 301 points.
            for legacy in tool.get('legacyPaths') or []:
                if not isinstance(legacy, str) or not isinstance(path, str):
                    continue
                alias = legacy.lstrip('/')
                if alias in entries or alias == path.lstrip('/'):
                    continue
                entries[alias] = {
                    'name': tool.get('name', ''), 'summary': tool.get('summary', ''),
                    'category': tool.get('category', ''), 'kind': 'redirect',
                    'surface': 'redirect', 'redirect_to': f'/{path.lstrip("/")}',
                }
        for slug, label in (data.get('categories') or {}).items():
            route = f'tools/category/{slug}'
            if route not in entries:
                entries[route] = {
                    'name': f'{label} tools', 'summary': 'CloudHost247 tool category',
                    'category': slug, 'kind': 'category', 'surface': 'signpost',
                }
    return entries


def tool_routes() -> set[str]:
    return set(tool_entries())


def php_files() -> set[str]:
    return {entry.name for entry in ROOT.iterdir() if entry.is_file() and entry.suffix == '.php'}


def route_owner(php_route: str, status: str, template: str) -> str:
    """The runtime a route is served by, from the file's own evidence rather than a hand-kept list.

    A template assignment means the CloudHost247 theme renders it. A licensed WHMCS entry point
    (`cart.php`, `clientarea.php`) is deployed with the platform and is not a file this repository
    ships — a distinction that matters when a report counts "pages" and a reader assumes all of them
    are in the archive. The tools front controller owns the `/tools` tree.
    """
    if php_route.startswith('tools/'):
        return ROUTE_OWNER_TOOLS
    if status == 'platform entry point':
        return ROUTE_OWNER_WHMCS
    if template:
        return ROUTE_OWNER_THEME
    if status == 'internal':
        return ROUTE_OWNER_INTERNAL
    if status == 'published':
        # A published page with no `setTemplate` call is rendered by the editorial route
        # (`cloudhost247-page.php`), which is still this theme.
        return ROUTE_OWNER_THEME
    return ROUTE_OWNER_UNREGISTERED


def test_status(status: str) -> str:
    """The checks that cover this route, named so the report can be audited command by command.

    Deliberately not a boolean: `passed` would be a claim about tests this script did not run. A
    published theme page is exercised by every check that needs no WHMCS and no database; a licensed
    entry point and an unregistered file are covered by syntax alone, and the two checks that need a
    prerequisite this repository cannot supply (a browser, a licensed install) are recorded as
    blocked rather than omitted.
    """
    if status == 'published':
        checks = list(THEME_PAGE_CHECKS)
    elif status == 'platform entry point':
        checks = ['staging-functional']
    else:
        checks = ['php-syntax']
    blocked = [f'{name} (blocked: {TEST_CHECK_BLOCKERS[name]})' for name in TEST_CHECK_BLOCKERS]
    return '; '.join(checks + blocked)


def walk_navigation(reg):
    """Yield every header destination with the menu and group that publishes it."""
    for menu in reg['menus']:
        if menu.get('href'):
            yield menu['href'], menu['id'], 'menu root', menu['label']
        for column in menu.get('columns', []):
            for item in column.get('items', []):
                yield item['href'], menu['id'], column['title'], item['label']


def walk_footer(reg):
    for column in reg['footer']:
        for item in column.get('items', []):
            yield item['href'], column['title'], item['label']


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--json', default=str(OUT_DIR / 'page-inventory.json'))
    parser.add_argument('--csv', default=str(OUT_DIR / 'page-inventory.csv'))
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args()

    reg = registry()
    site = load_json(SITE_JSON)
    pages = site.get('pages', {})
    tools = tool_routes()
    files = php_files()

    # ---------------------------------------------------------------- navigation index
    nav_index: dict[str, list[str]] = {}
    for href, menu_id, group, label in walk_navigation(reg):
        if href.get('php'):
            nav_index.setdefault(href['php'].split('?')[0], []).append(f'{menu_id} / {group}')

    # The Legal & Policy Center is a real discovery surface: it is how a visitor and a crawler
    # reach the policies deliberately kept out of the footer. Counting it as navigation is what
    # separates a genuine orphan from a policy that is simply indexed one level down.
    legal_center = ROOT / 'legal.php'
    if legal_center.is_file():
        for declared in re.findall(
            r"'(?:link|url)'\s*=>\s*'([^']+\.php)'", legal_center.read_text(encoding='utf-8')
        ):
            nav_index.setdefault(declared, []).append('legal / Legal & Policy Center')

    footer_index: dict[str, list[str]] = {}
    for href, column, label in walk_footer(reg):
        if href.get('php'):
            footer_index.setdefault(href['php'].split('?')[0], []).append(column)

    # ---------------------------------------------------------------------- build rows
    rows = []
    for php_route in sorted(files):
        published = php_route in pages
        meta = pages.get(php_route, {})
        is_internal = php_route in INTERNAL_FILES or php_route.endswith(INTERNAL_SUFFIXES)
        is_whmcs = php_route in WHMCS_ENTRY_POINTS
        nav = sorted(set(nav_index.get(php_route, [])))
        foot = sorted(set(footer_index.get(php_route, [])))

        if published:
            status = 'published'
        elif is_whmcs:
            status = 'platform entry point'
        elif is_internal:
            status = 'internal'
        else:
            status = 'unregistered'

        seo_notes = []
        if published:
            if not meta.get('seo_description'):
                seo_notes.append('no seo_description')
            if not meta.get('title'):
                seo_notes.append('no title')
            if not meta.get('summary'):
                seo_notes.append('no summary')
        seo_status = 'n/a' if not published else ('ok' if not seo_notes else '; '.join(seo_notes))

        visual = meta.get('visual', '')
        image_status = 'n/a'
        if visual:
            asset = ROOT / 'assets' / 'images' / 'cloudhost247' / f'{visual}.svg'
            image_status = 'present' if asset.is_file() else 'MISSING'

        reachable = bool(nav or foot)
        template = (' | '.join(re.findall(r"setTemplate\('([^']+)'\)", (ROOT / php_route).read_text())) or 'cloudhost247-page') if published else ''
        hero_asset = f'{visual}.svg' if visual else ''
        rows.append({
            'php_page': php_route,
            'path': f'/{php_route}' if published else '',
            'canonical_url': f'/{php_route}' if published else '',
            'title': meta.get('title', ''),
            'page_title': meta.get('title', ''),
            'category': meta.get('category', ''),
            'route_owner': route_owner(php_route, status, template),
            'status': status,
            'implementation_status': status,
            'template': template,
            'test_status': test_status(status),
            'seo_metadata': {'title': meta.get('title', ''), 'description': meta.get('seo_description',meta.get('summary',''))},
            'hero_artwork': {'svg': hero_asset, 'scene': meta.get('visual3d','')},
            'hero_asset': hero_asset,
            'visual': visual,
            'image_status': image_status,
            'seo_status': seo_status,
            'navigation_placement': ' | '.join(nav),
            'navigation_location': ' | '.join(nav),
            'footer_placement': ' | '.join(foot),
            'footer_location': ' | '.join(foot),
            'reachable': reachable,
        })

    # --------------------------------------------- routes the licensed platform serves
    # `cart.php`, `clientarea.php`, `knowledgebase.php` and the rest are navigation destinations
    # with no file in this tree: they ship with the WHMCS install. They belong in the inventory
    # because a visitor reaches them from the menus, and they are marked as platform entry points
    # rather than published theme pages so nobody counts them as parity work on this repository.
    platforms = set()
    for href, _menu, _group, _label in walk_navigation(reg):
        if href.get('php'):
            platforms.add(href['php'].split('?')[0])
    for href, _column, _label in walk_footer(reg):
        if href.get('php'):
            platforms.add(href['php'].split('?')[0])
    for entry in sorted(platforms):
        if entry in files or entry == 'tools' or entry.startswith('tools/'):
            continue
        if entry not in WHMCS_ENTRY_POINTS:
            continue
        rows.append({
            'php_page': entry,
            'path': '',
            'canonical_url': '',
            'title': '',
            'page_title': '',
            'category': 'Platform',
            'route_owner': ROUTE_OWNER_WHMCS,
            'status': 'platform entry point',
            'implementation_status': 'platform entry point',
            'template': '',
            'test_status': test_status('platform entry point'),
            'seo_metadata': {'title': '', 'description': ''},
            'hero_artwork': {'svg': '', 'scene': ''},
            'hero_asset': '',
            'visual': '',
            'image_status': 'n/a',
            'seo_status': 'n/a',
            'navigation_placement': ' | '.join(sorted(set(nav_index.get(entry, [])))),
            'navigation_location': ' | '.join(sorted(set(nav_index.get(entry, [])))),
            'footer_placement': ' | '.join(sorted(set(footer_index.get(entry, [])))),
            'footer_location': ' | '.join(sorted(set(footer_index.get(entry, [])))),
            'reachable': bool(nav_index.get(entry) or footer_index.get(entry)),
        })

    # ------------------------------------------------------------- the tools front controller
    STATUS_BY_SURFACE = {
        'native': 'published tool route',
        'signpost': 'platform signpost route',
        'redirect': 'redirect alias',
    }
    for route, entry in tool_entries().items():
        status = STATUS_BY_SURFACE[entry['surface']]
        tool_nav = sorted(set(nav_index.get(route, [])))
        tool_foot = sorted(set(footer_index.get(route, [])))
        kind = entry['kind']
        rows.append({
            'php_page': f'{route}.php' if route != 'tools' else 'tools/index.php',
            'path': f'/{route}',
            # An alias 301s to its tool, so its canonical address is the tool's, not its own.
            'canonical_url': f'/{route}' if entry['surface'] != 'redirect' else entry['redirect_to'],
            'title': entry['name'],
            'page_title': entry['name'],
            'category': 'Tools' if kind == 'hub' else 'Tool category' if kind == 'category' else 'Tool',
            'route_owner': ROUTE_OWNER_TOOLS,
            'status': status,
            'implementation_status': status,
            'template': 'cloudhost247-tools',
            'test_status': test_status('published'),
            'seo_metadata': {'title': entry['name'], 'description': entry['summary']},
            'hero_artwork': {'svg': '', 'scene': ''},
            'hero_asset': '',
            'visual': entry.get('category', ''),
            'image_status': 'n/a',
            # A signpost is served `X-Robots-Tag: noindex`: it names the tool and hands over to the
            # platform rather than pretending to be it. An alias is not indexed at all — it is a 301.
            'seo_status': {
                'signpost': 'noindex signpost',
                'redirect': 'redirects (301)',
            }.get(entry['surface'], 'ok' if entry['name'] else 'no title'),
            'navigation_placement': ' | '.join(tool_nav),
            'navigation_location': ' | '.join(tool_nav),
            'footer_placement': ' | '.join(tool_foot),
            'footer_location': ' | '.join(tool_foot),
            'reachable': True,  # the front controller answers every route in this list
        })

    # ------------------------------------------------------------------- defect classes
    menu_links_without_pages = []
    for href, menu_id, group, label in walk_navigation(reg):
        target = href.get('php')
        if not target:
            continue
        path = target.split('?')[0].split('#')[0]
        if path in files or path in WHMCS_ENTRY_POINTS or path in tools or path == 'tools':
            continue
        menu_links_without_pages.append({'where': f'{menu_id} / {group}', 'label': label, 'php': target})
    for href, column, label in walk_footer(reg):
        target = href.get('php')
        if not target:
            continue
        path = target.split('?')[0].split('#')[0]
        if path in files or path in WHMCS_ENTRY_POINTS or path in tools or path == 'tools':
            continue
        menu_links_without_pages.append({'where': f'footer / {column}', 'label': label, 'php': target})

    # ------------------------------------------------------------------ hero artwork
    # "A distinct hero visual per product page" is a requirement, and the artwork a page actually
    # renders is the resolved 3D scene, not the key its author typed: `scripts/site/generate.mjs`
    # upgrades `<visual>-3d` when that scene exists and otherwise falls back to the family's scene
    # (`FAMILY_3D`). Reading only the registry would therefore report a coverage the site does not
    # have. Comparing the two names is what tells an exact scene from a family fallback, and a page
    # on a fallback shares its artwork with every other page in that family — so this is reported
    # rather than hidden. It is deliberately NOT a defect: a family fallback is a real scene chosen
    # on purpose, while a missing scene would be a broken image, which `image_status` already
    # covers.
    hero_exact, hero_fallback = [], []
    for row in rows:
        if row['status'] != 'published':
            continue
        visual = row['visual']
        scene = row['hero_artwork']['scene']
        if not visual:
            continue
        if scene == f'{visual}-3d':
            hero_exact.append(row['php_page'])
        elif scene:
            hero_fallback.append({
                'php_page': row['php_page'],
                'visual': visual,
                'scene': scene,
                'shared_with': '',
            })
    shared = {}
    for entry in hero_fallback:
        shared.setdefault(entry['scene'], []).append(entry['php_page'])
    for entry in hero_fallback:
        entry['shared_with'] = ', '.join(
            page for page in shared[entry['scene']] if page != entry['php_page']
        )

    orphaned = [
        row for row in rows
        if row['status'] == 'published' and not row['reachable']
    ]
    without_discovery = [
        row for row in rows
        if row['reachable'] and not row['navigation_placement'] and row['status'] == 'published'
    ]
    unregistered_public = [
        row for row in rows
        if row['status'] == 'unregistered' and not row['php_page'].startswith(('builder-', 'cloudhost247-'))
    ]

    # A redirect whose target is not a page this inventory lists is a 301 into nothing: the visitor
    # leaves a working URL and arrives at a 404. The target is checked against the rows rather than
    # against the catalogue, because a route can be in a catalogue and still have no row.
    served_paths = {row['path'] for row in rows if row['path']}
    dangling_redirects = [
        {'path': row['path'], 'redirect_to': row['canonical_url']}
        for row in rows
        if row['implementation_status'] == 'redirect alias' and row['canonical_url'] not in served_paths
    ]

    # Redirect aliases legitimately share their target's canonical — that is what makes them
    # aliases. Every other row must own its canonical address outright: two pages naming one
    # canonical is how a whole section silently drops out of the index.
    by_canonical: dict[str, list[str]] = {}
    for row in rows:
        if row['implementation_status'] in ('redirect alias', 'internal') or not row['canonical_url']:
            continue
        by_canonical.setdefault(row['canonical_url'], []).append(row['path'] or row['php_page'])
    duplicate_canonicals = [
        {'canonical_url': canonical, 'paths': paths}
        for canonical, paths in sorted(by_canonical.items()) if len(paths) > 1
    ]

    owners = {}
    for row in rows:
        owners[row['route_owner']] = owners.get(row['route_owner'], 0) + 1

    report = {
        'source': 'shared/site/registry.json',
        'field_notes': {
            'path': 'the route a visitor requests; empty when the file is not a published route',
            'route_owner': 'the runtime that serves it: cloudhost247-theme, whmcs-core (deployed with '
                           'the licensed platform, not vendored here), tools-front-controller or internal',
            'implementation_status': 'published | published tool route | platform signpost route '
                                     '(served noindex, hands over to the platform app) | redirect alias '
                                     '(a 301 named under `legacyPaths`) | platform entry point | internal | unregistered',
            'test_status': 'the checks that cover this route, by id; see test_checks for the command '
                           'each id runs and any prerequisite that blocks it on this host',
            'hero_asset': 'the vector diagram the page publishes; image_status says whether it exists',
        },
        'test_checks': TEST_CHECKS,
        'test_check_blockers': TEST_CHECK_BLOCKERS,
        'totals': {
            'root_php_pages': len(files),
            'registered_public_pages': len(pages),
            'navigation_destinations': sum(1 for _ in walk_navigation(reg)),
            'footer_destinations': sum(1 for _ in walk_footer(reg)),
            'mega_menus': len(reg['menus']),
            'footer_columns': len(reg['footer']),
            'hero_scenes_exact': len(hero_exact),
            'hero_scenes_from_family_fallback': len(hero_fallback),
            'distinct_hero_scenes': len({row['hero_artwork']['scene'] for row in rows if row['hero_artwork']['scene']}),
            'pages_by_route_owner': dict(sorted(owners.items())),
        },
        'defects': {
            'orphaned_pages': orphaned,
            'menu_links_without_pages': menu_links_without_pages,
            'pages_without_navigation_discovery': without_discovery,
            'unregistered_public_pages': unregistered_public,
            'dangling_redirect_targets': dangling_redirects,
            'duplicate_canonical_addresses': duplicate_canonicals,
        },
        'pages': rows,
        'hero_fallbacks': hero_fallback,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Path(args.json).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    with Path(args.csv).open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()), lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)

    totals = report['totals']
    print('== CloudHost247 canonical page inventory ==')
    print(f"root PHP pages            : {totals['root_php_pages']}")
    print(f"registered public pages   : {totals['registered_public_pages']}")
    print(f"mega menus / footer cols  : {totals['mega_menus']} / {totals['footer_columns']}")
    print(f"navigation destinations   : {totals['navigation_destinations']}")
    print(f"footer destinations       : {totals['footer_destinations']}")
    print(f"distinct hero 3D scenes   : {totals['distinct_hero_scenes']}")
    print(f"hero scenes exact match   : {totals['hero_scenes_exact']}")
    print(f"hero scenes family fallback: {totals['hero_scenes_from_family_fallback']}")
    print('route owners              : ' + ', '.join(
        f'{owner} {count}' for owner, count in totals['pages_by_route_owner'].items()
    ))
    print()
    print(f"ORPHANED PAGES            : {len(orphaned)}")
    for row in orphaned:
        print(f"   · {row['php_page']}")
    print(f"MENU LINKS WITHOUT PAGES  : {len(menu_links_without_pages)}")
    for row in menu_links_without_pages:
        print(f"   · {row['where']}: {row['label']} → {row['php']}")
    print(f"PAGES WITHOUT NAV DISCOV. : {len(without_discovery)}")
    for row in without_discovery:
        print(f"   · {row['php_page']} (footer only: {row['footer_placement']})")
    print(f"UNREGISTERED PUBLIC PAGES : {len(unregistered_public)}")
    for row in unregistered_public:
        print(f"   · {row['php_page']}")
    print(f"DANGLING REDIRECTS        : {len(dangling_redirects)}")
    for row in dangling_redirects:
        print(f"   · {row['path']} → {row['redirect_to']} (no such page)")
    print(f"DUPLICATE CANONICALS      : {len(duplicate_canonicals)}")
    for row in duplicate_canonicals:
        print(f"   · {row['canonical_url']} claimed by {', '.join(row['paths'])}")
    print()
    print(f"wrote {args.json}")
    print(f"wrote {args.csv}")

    defects = sum(len(report['defects'][key]) for key in (
        'orphaned_pages', 'menu_links_without_pages', 'pages_without_navigation_discovery',
        'dangling_redirect_targets', 'duplicate_canonical_addresses',
    ))
    if args.strict and defects:
        print(f'\n✖ {defects} navigation defect(s) present', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
