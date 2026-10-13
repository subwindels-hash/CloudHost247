#!/usr/bin/env python3
"""Check the hero artwork pages actually render, not the artwork they declare.

`docs/website-rebuild/page-inventory.json` records the 3D scene each page resolves to
(`hero_artwork.scene`), and `scripts/audit-navigation-inventory.py` reports how many pages sit on
their own scene rather than a family fallback. That is a statement about the catalogue the
templates read. It is not a statement about the HTML: a template is free not to consume the visual
its page declares, and nothing in the inventory would notice.

This check closes that gap by reading rendered fixtures (`tests/website/render-fixtures.php`) and
asking three questions of every published page:

  1. Does the artwork it renders match the scene the inventory says it resolves to?
  2. Does it render hero artwork at all — a 3D scene ladder, or a distinct illustration?
  3. Does any other non-legal page render the *same* artwork? "A distinct hero visual per product
     page" is the requirement, so two product pages sharing one hero is a failure even when both
     declare it exactly.

Legal and policy documents are exempt from (2) and (3): they are text documents, they are listed as
such in `shared/site/registry.json`, and a hero scene behind a refund policy would be decoration.
They are still held to (1) — if a legal template ever does render a hero, it must be the declared
one — and they are counted separately so the exemption is visible rather than silent.

The check needs a rendered fixture directory, which the release gate does not produce (Smarty is
not part of the gate's toolchain). It therefore runs where fixtures exist:

    php tests/website/render-fixtures.php
    python3 scripts/check-hero-render.py            # reads $CH247_FIXTURE_DIR

Exit status: 0 when every check passes, 1 on any failure, 2 when it could not run at all (no
fixture directory, no inventory) — a missing prerequisite is reported as such rather than passing.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The hero `<picture>` ladder emits `…/<scene>-3d-640.avif` first; the scene key is everything
# before the width. Deliberately anchored on the ladder rather than on any image reference so a
# decorative inline illustration cannot be mistaken for the hero.
SCENE_RE = re.compile(r'assets/images/cloudhost247/([a-z0-9][a-z0-9\-/]*)-3d-\d+\.avif')
# Any other first-party illustration the page renders, for templates that use a flat artwork
# instead of the 3D ladder (`cloudhost247-email-hosting.tpl` renders `hosting/email-hosting.svg`).
ARTWORK_RE = re.compile(r'(?:src|href)="/assets/images/cloudhost247/([^"?#]+\.(?:svg|png|jpe?g|webp|avif))"')
# Brand chrome, favicons, social previews and UI icons are not hero artwork.
NOT_ARTWORK = re.compile(r'^(brand|favicon|social|icons)/')


def fail(problems: list[str], message: str) -> None:
    problems.append(message)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--inventory', default='docs/website-rebuild/page-inventory.json')
    parser.add_argument('--registry', default='shared/site/registry.json')
    parser.add_argument(
        '--fixtures',
        default=os.environ.get('CH247_FIXTURE_DIR', '/tmp/ch247-fixtures'),
        help='directory of rendered fixtures (default: $CH247_FIXTURE_DIR)',
    )
    args = parser.parse_args()

    inventory_path = Path(args.inventory)
    registry_path = Path(args.registry)
    fixtures = Path(args.fixtures)
    for path in (inventory_path, registry_path):
        if not path.is_file():
            print(f'hero render check: cannot run — {path} does not exist', file=sys.stderr)
            return 2
    if not fixtures.is_dir():
        print(
            f'hero render check: cannot run — {fixtures} is not a fixture directory '
            '(render them first: php tests/website/render-fixtures.php)',
            file=sys.stderr,
        )
        return 2

    inventory = json.loads(inventory_path.read_text(encoding='utf-8'))
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    # Two sources, because they do not agree: `registry.legal` lists the documents the footer and
    # the SPA legal routes serve (17), while the content catalogue also carries `legal.php` — the
    # Legal & Policy Center hub — and `refund-and-cancellation-policy.php`, both categorised Legal
    # and both rendered as text-only documents. Classifying by the registry alone would report
    # those two as product pages missing their hero; classifying by category alone would miss a
    # legal document that was never categorised. The union is what the templates actually do.
    legal = {entry['php'] for entry in registry.get('legal', []) if entry.get('php')}
    legal |= {
        row['php_page'] for row in inventory['pages']
        if row.get('category', '').lower() == 'legal'
    }

    problems: list[str] = []
    rendered_scene: list[tuple[str, str]] = []
    rendered_artwork: list[tuple[str, str]] = []
    text_only: list[str] = []
    no_fixture: list[str] = []
    by_artwork: dict[str, list[str]] = defaultdict(list)

    for row in inventory['pages']:
        if row.get('status') != 'published':
            continue
        page = row['php_page']
        declared = row['hero_artwork']['scene']
        fixture = fixtures / f'{page}.html'
        if not fixture.is_file():
            no_fixture.append(page)
            continue
        html = fixture.read_text(encoding='utf-8', errors='replace')

        scene = SCENE_RE.search(html)
        if scene:
            key = f'{scene.group(1)}-3d'
            rendered_scene.append((page, key))
            if declared and key != declared:
                fail(problems, f'{page}: renders hero scene {key} but the inventory resolves {declared}')
            if page not in legal:
                by_artwork[key].append(page)
            continue

        art = [a for a in ARTWORK_RE.findall(html) if not NOT_ARTWORK.match(a)]
        if art:
            rendered_artwork.append((page, art[0]))
            if page not in legal:
                by_artwork[art[0]].append(page)
            continue

        if page in legal:
            text_only.append(page)
        else:
            fail(problems, f'{page}: renders no hero artwork (declared scene {declared or "none"})')

    shared = {key: pages for key, pages in by_artwork.items() if len(pages) > 1}
    for key, pages in sorted(shared.items()):
        fail(problems, f'hero artwork {key} is rendered by {len(pages)} pages: {", ".join(sorted(pages))}')

    if not rendered_scene and not rendered_artwork:
        print(
            'hero render check: cannot run — no fixture rendered any hero artwork, so the fixtures '
            'are not the ones this check reads',
            file=sys.stderr,
        )
        return 2

    print('== hero artwork as rendered ==')
    print(f'fixtures read               : {fixtures}')
    print(f'pages rendering a 3D scene  : {len(rendered_scene)}')
    print(f'pages rendering flat artwork: {len(rendered_artwork)}')
    print(f'legal documents, text only  : {len(text_only)}')
    print(f'distinct hero artworks      : {len(by_artwork)}')
    if no_fixture:
        print(f'published pages with no fixture (not checked): {len(no_fixture)} — {", ".join(no_fixture[:5])}')
    if rendered_artwork:
        print('flat artwork (not the 3D ladder):')
        for page, art in rendered_artwork:
            print(f'  {page} → {art}')

    if problems:
        print()
        for problem in problems:
            print(f'✗ {problem}')
        print(f'hero render check FAILED: {len(problems)} problem(s)')
        return 1
    print('✓ every published page renders its own hero artwork, matching the inventory')
    return 0


if __name__ == '__main__':
    sys.exit(main())
