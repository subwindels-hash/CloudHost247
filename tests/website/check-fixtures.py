#!/usr/bin/env python3
"""Static QA for the rendered template fixtures.

`tests/website/browser.cjs` checks overflow, focus behaviour and axe accessibility in a real
browser. That needs a Chromium binary, and it cannot run everywhere. This companion runs the checks
that do not need one — the ones that catch a broken build rather than a broken pixel:

  * exactly one `<h1>` per page, and one header, main and footer landmark;
  * no duplicate `id` (an anchor jump that lands on the wrong element);
  * every referenced asset exists on disk (a broken image is invisible until someone looks);
  * every `alt` present, so a decorative image is explicit rather than forgotten;
  * every internal link resolves to a rendered fixture, a licensed WHMCS entry point or a tool route;
  * every published navigation fragment lands on an element with that id;
  * every `ch-`/`ch247-` class a visitor sees is defined by a stylesheet the repository ships (a
    class nobody styles renders as an unstyled box, which is how parallel design systems start);
  * a heading outline that never skips a level, and legal documents that render as documents (the
    harness must supply the array their root PHP page publishes) rather than as empty shells;
  * the head a crawler receives: stylesheet order, one title, a description, and the rule that a
    page is either indexable with a canonical and JSON-LD or explicitly `noindex` — never indexed
    twice under the same title, never canonical without being indexable.

Usage:
    CH247_FIXTURE_DIR=/path/to/fixtures python3 tests/website/check-fixtures.py

It is not part of the release gate: the gate has no Smarty and no fixtures. Run it wherever the
fixtures were rendered (see tests/website/render-fixtures.php).
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(os.environ.get('CH247_FIXTURE_DIR', '')).expanduser()

WHMCS_ENTRY_POINTS = {
    'index.php', 'cart.php', 'clientarea.php', 'register.php', 'logout.php', 'pwreset.php',
    'contact.php', 'knowledgebase.php', 'submitticket.php', 'serverstatus.php', 'announcements.php',
    'supporttickets.php', 'viewticket.php', 'domainchecker.php',
}

# The platform is mounted under one path prefix (Site::platformPath); links into it are served by
# the application, not by these templates, and the fixture harness has nothing to render for them.
PLATFORM_PATH = os.environ.get('CH247_PLATFORM_PATH', '/platform')

TAG_RE = re.compile(r'<(h1|main|header|footer)\b[^>]*>', re.I)
IMG_RE = re.compile(r'<img\b[^>]*>', re.I)
ID_RE = re.compile(r'\bid="([^"]+)"')
ATTR_RE = re.compile(r'([a-zA-Z-]+)="([^"]*)"')
LINK_RE = re.compile(r'<a\b[^>]*\bhref="([^"]*)"', re.I)
ASSET_RE = re.compile(r'(?:src|href)="(/?(?:assets|templates)/[^"]+)"', re.I)
CONTROL_RE = re.compile(r'<(a|button|input|select|textarea|summary)\b', re.I)
CLASS_RE = re.compile(r'class="([^"]*)"', re.I)
TITLE_RE = re.compile(r'<title>(.*?)</title>', re.I | re.S)
DESCRIPTION_RE = re.compile(r'<meta\s+name="description"\s+content="([^"]*)"', re.I)
CANONICAL_RE = re.compile(r'<link\s+rel="canonical"\s+href="([^"]*)"', re.I)
ROBOTS_NOINDEX_RE = re.compile(r'<meta\s+name="robots"\s+content="[^"]*noindex', re.I)
LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.I | re.S)
STYLESHEET_RE = re.compile(r'<link\s+rel="stylesheet"\s+href="([^"]*)"', re.I)

# Components are allowed to be described by the application bundle as well as by template CSS: the
# React side of the platform styles some of the same names from `cloudhost247-node/frontend`.
CSS_GLOBS = ('templates/**/*.css', 'assets/**/*.css', 'shared/site/*.css', 'cloudhost247-node/frontend/src/**/*.css')
STYLE_SEARCH_DIRS = ('templates', 'assets', 'cloudhost247-node/frontend/src', 'shared/site')
CLASS_NAME_RE = re.compile(r'^ch(247)?-[a-z0-9-]+$')


def shipped_styles() -> str:
    """Every CSS declaration string the repository ships, for class-coverage checks."""
    styles = []
    for directory in STYLE_SEARCH_DIRS:
        base = ROOT / directory
        if base.is_dir():
            styles += [path.read_text(errors='ignore') for path in base.rglob('*.css')]
    return '\n'.join(styles)


def attribute(tag: str, name: str) -> str | None:
    for key, value in ATTR_RE.findall(tag):
        if key.lower() == name:
            return value
    return None


def fixture_files() -> list[Path]:
    return sorted(FIXTURES.rglob('*.html'))


def check(failures: list[str], condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def main() -> int:
    if not FIXTURES.is_dir():
        print('CH247_FIXTURE_DIR is not set to a directory of rendered fixtures.', file=sys.stderr)
        return 2
    files = fixture_files()
    if not files:
        print(f'no fixtures found under {FIXTURES}', file=sys.stderr)
        return 2

    registry = json.loads((ROOT / 'shared/site/registry.json').read_text())
    catalog = json.loads((ROOT / 'modules/addons/cloudhost247_theme/resources/site.json').read_text())
    published_fragments: dict[str, set[str]] = {}
    for menu in registry['menus']:
        hrefs = [menu.get('href') or {}]
        hrefs += [item.get('href') or {} for column in menu.get('columns', []) for item in column.get('items', [])]
        for href in hrefs:
            php = href.get('php') or ''
            if '#' in php:
                page, fragment = php.split('#', 1)
                published_fragments.setdefault(page, set()).add(fragment)

    section_anchors = {
        section['anchor']
        for page in catalog['pages'].values()
        for section in page.get('sections') or []
        if section.get('anchor')
    }

    failures: list[str] = []
    counters = {'pages': 0, 'images': 0, 'links': 0, 'assets': 0, 'controls': 0, 'classes': 0,
                'indexable': 0, 'noindex': 0}
    legal_documents = ('backup-policy.php', 'cybercrime-policy.php', 'refund-policy.php',
                       'trademark-policy.php', 'domain-brokerage-terms.php')
    classes_seen: dict[str, set[str]] = {}
    titles: dict[str, list[str]] = {}

    for path in files:
        route = path.relative_to(FIXTURES).as_posix()[: -len('.html')]
        source = path.read_text()
        counters['pages'] += 1

        tags = [match.group(1).lower() for match in TAG_RE.finditer(source)]
        check(failures, tags.count('h1') == 1, f'{route}: {tags.count("h1")} <h1> elements')
        check(failures, tags.count('main') == 1, f'{route}: {tags.count("main")} <main> elements')
        check(failures, tags.count('header') >= 1, f'{route}: no <header>')
        check(failures, tags.count('footer') >= 1, f'{route}: no <footer>')

        ids = ID_RE.findall(source)
        duplicates = {value for value in ids if ids.count(value) > 1}
        check(failures, not duplicates, f'{route}: duplicate id(s) {sorted(duplicates)[:3]}')

        body = source[source.lower().find('<body'):] if '<body' in source.lower() else source
        levels = [int(level) for level in re.findall(r'<h([1-6])\b', body)]
        previous = 1
        for level in levels:
            check(failures, level <= previous + 1, f'{route}: heading outline jumps from h{previous} to h{level}')
            previous = level
        if route in legal_documents:
            check(failures, levels.count(2) >= 3, f'{route}: legal document rendered as an empty shell ({levels.count(2)} h2)')

        head = source[: source.lower().find('</head>')] if '</head>' in source.lower() else source

        titles_found = TITLE_RE.findall(head)
        check(failures, len(titles_found) == 1, f'{route}: {len(titles_found)} <title> elements')
        title = html.unescape(titles_found[0]).strip() if len(titles_found) == 1 else ''
        check(failures, bool(title), f'{route}: empty <title>')

        sheets = [html.unescape(href) for href in STYLESHEET_RE.findall(head)]
        theme_sheets = [href for href in sheets if '/css/' in href and not href.startswith('http')]
        check(failures, any(href.endswith('site.css') or 'site.css?' in href for href in theme_sheets), f'{route}: site.css is not loaded')
        check(failures, any('design-system.css' in href for href in theme_sheets), f'{route}: design-system.css is not loaded')
        order = [next((index for index, href in enumerate(theme_sheets) if name in href), -1) for name in ('site.css?v', 'design-system.css?v')]
        check(failures, -1 not in order and order[1] > order[0], f'{route}: design-system.css must load after site.css (the design system wins shared names)')

        description = DESCRIPTION_RE.findall(head)
        check(failures, bool(description and html.unescape(description[0]).strip()), f'{route}: no meta description')

        noindex = bool(ROBOTS_NOINDEX_RE.search(head))
        canonical = CANONICAL_RE.findall(head)
        scripts = LDJSON_RE.findall(head)
        counters['noindex' if noindex else 'indexable'] += 1
        check(failures, not (noindex and canonical), f'{route}: canonical URL on a noindex page')
        if not noindex:
            if title:
                titles.setdefault(title, []).append(route)
            check(failures, bool(canonical), f'{route}: an indexable page needs a canonical URL')
            check(failures, len(scripts) >= 1, f'{route}: an indexable page needs JSON-LD')
            check(failures, description and len(html.unescape(description[0])) >= 40, f'{route}: an indexable page needs a real description')
        for block in scripts:
            try:
                data = json.loads(block)
            except json.JSONDecodeError as error:
                failures.append(f'{route}: JSON-LD does not parse ({error})')
                continue
            check(failures, isinstance(data, dict) and data.get('@context') and data.get('@type'), f'{route}: JSON-LD without @context/@type')
            check(failures, bool(str(data.get('name', '')).strip()), f'{route}: JSON-LD without a name')
            check(failures, bool(str(data.get('url', '')).strip()), f'{route}: JSON-LD without a url')

        for anchor in published_fragments.get(route, set()):
            check(failures, anchor in ids or anchor in section_anchors, f'{route}: published fragment #{anchor} has no target')

        for tag in IMG_RE.finditer(source):
            counters['images'] += 1
            markup = tag.group(0)
            check(failures, 'alt=' in markup, f'{route}: <img> without alt: {markup[:90]}')

        for match in ASSET_RE.finditer(source):
            counters['assets'] += 1
            target = match.group(1).lstrip('/')
            if target.startswith('assets/cloudhost247-tools/') or target.startswith('templates/'):
                continue  # built bundles and stylesheets are produced by the build, not committed
            check(failures, (ROOT / target).is_file(), f'{route}: missing asset {target}')

        for match in LINK_RE.finditer(source):
            href = html.unescape(match.group(1)).strip()
            counters['links'] += 1
            if not href or href.startswith(('#', 'mailto:', 'tel:', 'http://', 'https://')):
                continue
            target, _, fragment = href.partition('#')
            target = target.split('?')[0].lstrip('/')
            if not target or target.startswith('assets/') or target.startswith('templates/'):
                continue
            candidates = {target, target.rstrip('/') + '/index.php', f'{target}.php'}
            exists = any((FIXTURES / f'{candidate}.html').is_file() for candidate in candidates if candidate)
            # A destination is live if the fixture harness rendered it, if this repository ships the
            # file (the XML sitemaps are generators, not pages, so they are never rendered), if it is
            # a licensed WHMCS entry point, if it is served by the mounted platform, or if it is a
            # published tool route.
            check(
                failures,
                exists
                or (ROOT / target).is_file()
                or target in WHMCS_ENTRY_POINTS
                or target.startswith(PLATFORM_PATH.lstrip('/'))
                or target.startswith('tools')
                or target in {'sitemap.xml', 'robots.txt'},
                f'{route}: link to {href} has no rendered page',
            )
            if fragment and not exists:
                continue

        for match in CLASS_RE.finditer(source):
            for name in match.group(1).split():
                if CLASS_NAME_RE.match(name):
                    classes_seen.setdefault(name, set()).add(route)

        for _ in CONTROL_RE.finditer(source):
            counters['controls'] += 1

    for title, routes in sorted(titles.items()):
        if len(routes) > 1:
            failures.append(f'{len(routes)} indexable pages share the title {title!r}: {sorted(routes)[:4]}')

    styles = shipped_styles()
    undefined = {
        name: sorted(routes)[:3]
        for name, routes in classes_seen.items()
        if re.search(r'\.' + re.escape(name) + r'(?![\w-])', styles) is None
    }
    counters['classes'] = len(classes_seen)
    for name, routes in sorted(undefined.items()):
        failures.append(f'class {name} is rendered but no shipped stylesheet defines it ({routes})')

    print(f'fixture QA: {counters["pages"]} pages, {counters["images"]} images, {counters["assets"]} asset references, '
          f'{counters["links"]} links, {counters["controls"]} interactive controls, '
          f'{counters["classes"]} distinct ch- classes, '
          f'{counters["indexable"]} indexable / {counters["noindex"]} noindex')
    if failures:
        print(f'\n{len(failures)} problem(s):', file=sys.stderr)
        for failure in failures[:60]:
            print(f'  · {failure}', file=sys.stderr)
        if len(failures) > 60:
            print(f'  … and {len(failures) - 60} more', file=sys.stderr)
        return 1
    print('✓ every rendered fixture is well-formed, fully referenced, fully styled and free of dead internal links')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
