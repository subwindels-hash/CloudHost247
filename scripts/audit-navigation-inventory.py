#!/usr/bin/env python3
"""Canonical public-page inventory and navigation-discovery audit.

Brief §31 asks for one table that answers, for every public page: which PHP file serves
it, what its canonical URL is, what it is called, how it is categorised, where it appears
in the header and the footer, what its SEO metadata looks like, and whether every link to
it resolves. It then asks for three specific defects to be named rather than inferred:

  ORPHANED PAGES              published, but no navigation and no footer reaches them
  MENU LINKS WITHOUT PAGES    a navigation or footer destination with no route behind it
  PAGES WITHOUT NAVIGATION    reachable only from the sitemap, not from any menu

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


def tool_routes() -> set[str]:
    """Every /tools/... path the PHP tools shell can resolve."""
    routes = {'tools'}
    for name in ('tools.json', 'tools-public.json'):
        path = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / name
        if not path.is_file():
            continue
        data = load_json(path)
        for tool in data.get('tools', []):
            if isinstance(tool.get('path'), str):
                routes.add(tool['path'].lstrip('/'))
        for slug in data.get('categories', {}):
            routes.add(f'tools/category/{slug}')
        for collection in data.get('collections', []):
            if isinstance(collection.get('path'), str):
                routes.add(collection['path'].lstrip('/'))
    return routes


def php_files() -> set[str]:
    return {entry.name for entry in ROOT.iterdir() if entry.is_file() and entry.suffix == '.php'}


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
        rows.append({
            'php_page': php_route,
            'canonical_url': f'/{php_route}' if published else '',
            'title': meta.get('title', ''),
            'category': meta.get('category', ''),
            'status': status,
            'template': meta.get('template', 'cloudhost247-page') if published else '',
            'visual': visual,
            'image_status': image_status,
            'seo_status': seo_status,
            'navigation_placement': ' | '.join(nav),
            'footer_placement': ' | '.join(foot),
            'reachable': reachable,
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

    report = {
        'source': 'shared/site/registry.json',
        'totals': {
            'root_php_pages': len(files),
            'registered_public_pages': len(pages),
            'navigation_destinations': sum(1 for _ in walk_navigation(reg)),
            'footer_destinations': sum(1 for _ in walk_footer(reg)),
            'mega_menus': len(reg['menus']),
            'footer_columns': len(reg['footer']),
        },
        'defects': {
            'orphaned_pages': orphaned,
            'menu_links_without_pages': menu_links_without_pages,
            'pages_without_navigation_discovery': without_discovery,
            'unregistered_public_pages': unregistered_public,
        },
        'pages': rows,
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
    print()
    print(f"wrote {args.json}")
    print(f"wrote {args.csv}")

    defects = sum(len(report['defects'][key]) for key in (
        'orphaned_pages', 'menu_links_without_pages', 'pages_without_navigation_discovery'
    ))
    if args.strict and defects:
        print(f'\n✖ {defects} navigation defect(s) present', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
