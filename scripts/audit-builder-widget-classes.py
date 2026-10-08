#!/usr/bin/env python3
"""Audit the Builder's server-rendered widget markup against the stylesheets it loads.

The Builder renders its own markup in PHP (`WidgetRenderer`), not in Smarty, so the theme class
audit in `scripts/verify-website.py` never sees it. That is how a whole family of widgets shipped
with class names that no stylesheet defines: the page renders, the gate passes, and the widget looks
like unstyled HTML.

This audit extracts every `ch247-` class the renderer can emit — including classes composed from a
literal prefix plus a variable at render time — and requires each one to have a rule in the sheet the
Builder actually serves. It is checked twice over:

* `runtime.css` is the sheet the Builder loads on a rendered page, so a class defined nowhere else is
  reported;
* the site design system and `site.css` are accepted as sources, because the public Builder page
  loads them alongside `runtime.css` and a widget is allowed to use a design-system component.

Run with `--json` for the machine-readable form the release gate consumes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'modules/addons/cloudhost247_builder'
RENDERER = MODULE / 'lib/Render/WidgetRenderer.php'
RUNTIME = MODULE / 'assets/css/runtime.css'
# Sheets the public Builder page loads around the rendered document. A widget class may come from
# any of them; only a class defined in none of them is a defect.
SITE_SHEETS = (
    ROOT / 'templates/cloudhost247/css/site.css',
    ROOT / 'templates/cloudhost247/css/design-system.css',
)

# PHP concatenation inside a class attribute: `'class="ch247-a ' . $variant . '"'`. Everything the
# variable contributes is unknown here, so the literal part becomes a prefix match.
CONCAT = re.compile(r"'?\s*\.\s*[^.]*?\$[^.]*?\.\s*'?")

# Classes that carry no rule on purpose. Each one is a hook whose styling comes from something other
# than its own selector, which the audit cannot see — so every entry needs a reason, and anything not
# listed here must be defined. Keeping the list explicit is the point: a new widget class is a
# failure until someone either styles it or writes down why it does not need styling.
HOOKS = {
    # Styled by the element rules at the top of runtime.css (`.ch247-root h1..h6`, `p`).
    'ch247-heading': 'heading element — styled by `.ch247-root h1..h6`',
    'ch247-section-heading': 'h2 — styled by `.ch247-root h2`',
    'ch247-domain__heading': 'h2 — styled by `.ch247-root h2`',
    'ch247-status__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-cta__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-form__title': 'h3 — styled by `.ch247-root h3`',
    'ch247-broker-cta__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-broker-status__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-broker-cases__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-broker-pricing__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-cart__heading': 'h3 — styled by `.ch247-root h3`',
    'ch247-text': 'plain block wrapper; its paragraphs are styled by `.ch247-root p`',
    # Variant markers: the base class already carries the layout, the modifier only records a choice.
    'ch247-list--icon': 'marker on `.ch247-list`; the list and its items are laid out by the base class',
    'ch247-domain-pricing': 'marker on `.ch247-table`; the table, wrap and note are styled by the table rules',
    'ch247-cta--brokerage': 'marker on `.ch247-cta`; the panel is laid out by the base class',
    'ch247-tabs__panels': 'wrapper; the panels inside it are styled by `.ch247-tabs__panel`',
    # Plain wrappers: the element is a box and every part that needs layout is a child with its own
    # rule, so adding one here would only repeat what the child already does.
    'ch247-status': 'wrapper — the list, rows, dots and states inside it carry the layout',
    'ch247-video': 'wrapper — the player and the embed frame carry the layout',
    'ch247-nav': 'wrapper — `.ch247-nav__list` and its items carry the layout',
    # Icons: `Icons::svg()` sets width, height and viewBox, and the container supplies the colour.
    'ch247-star': 'icon — sized by the svg attributes, coloured by `.ch247-testimonial__rating`',
}


def emitted_classes(source: str) -> dict[str, str]:
    """class token -> the partial token it came from (`ch247-btn--*` for a composed name)."""
    found: dict[str, str] = {}
    for match in re.finditer(r'class=\\?"(?P<body>.*?)\\?"', source, re.DOTALL):
        raw = match.group('body')
        # Replace each concatenation with a marker, then split on whitespace.
        marked = CONCAT.sub('\x00', raw)
        for token in marked.split():
            if not token.startswith('ch247-'):
                continue
            if '\x00' in token:
                prefix = token.split('\x00')[0]
                if len(prefix) > len('ch247-'):
                    found[prefix + '*'] = token
            else:
                found[token] = token
    # `Icons::svg('star', 16, 'ch247-star')` passes the class as an argument, not in an attribute.
    for match in re.finditer(r"Icons::svg\([^)]*?'(ch247-[A-Za-z0-9_-]+)'", source):
        found[match.group(1)] = match.group(1)
    return found


def defined_in(sheet: Path) -> str:
    return sheet.read_text()


def has_rule(token: str, css: str) -> bool:
    """Is there a rule for exactly this class?

    A composed token (`ch247-btn--*`, built from a prefix plus a variable) matches any class that
    starts with it, because the suffix is only known at render time. A plain token must match exactly:
    `.ch247-broker-pricing__amount-renamed` is a *different* class from `...__amount`, and treating it
    as a match is how a renamed selector keeps passing an audit it should fail.
    """
    if token.endswith('*'):
        return re.search(r'\.' + re.escape(token[:-1]) + r'[A-Za-z0-9_-]*', css) is not None
    return re.search(r'\.' + re.escape(token) + r'(?![\w-])', css) is not None


def audit() -> dict:
    classes = emitted_classes(RENDERER.read_text())
    runtime = defined_in(RUNTIME)
    site = '\n'.join(defined_in(path) for path in SITE_SHEETS if path.is_file())
    unstyled = sorted(token for token in classes if not has_rule(token, runtime))
    outside = sorted(token for token in unstyled if has_rule(token, site))
    hooks = sorted(token for token in unstyled if token in HOOKS and token not in outside)
    return {
        'classes_emitted': len(classes),
        'defined_by_runtime': len(classes) - len(unstyled),
        'defined_by_site_sheets_only': outside,
        'documented_hooks': hooks,
        'undefined': [token for token in unstyled if token not in outside and token not in HOOKS],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--json', action='store_true', help='machine-readable output')
    args = parser.parse_args()

    result = audit()
    if args.json:
        print(json.dumps({'builder_widget_classes': result}, indent=2, sort_keys=True))
    else:
        print(f'builder widget classes emitted: {result["classes_emitted"]}')
        print(f'  defined by runtime.css: {result["defined_by_runtime"]}')
        print(f'  from the site sheets:   {len(result["defined_by_site_sheets_only"])}')
        print(f'  documented hooks:       {len(result["documented_hooks"])}')
        for token in result['undefined']:
            print(f'  UNDEFINED:              {token}')
        if result['documented_hooks']:
            print('\n  hooks (no rule by design):')
            for token in result['documented_hooks']:
                print(f'    {token:34} {HOOKS[token]}')

    classes = emitted_classes(RENDERER.read_text())
    stale = sorted(token for token in HOOKS if token not in classes and '*' not in token)
    if stale:
        sys.stderr.write(f'\n✖ {len(stale)} hook exemption(s) no longer match anything the renderer emits:\n')
        for token in stale:
            sys.stderr.write(f'  - {token}\n')
        sys.stderr.write('  Remove them: an exemption that cannot fail is not documenting anything.\n')
        return 1
    if result['undefined']:
        sys.stderr.write(f'\n✖ {len(result["undefined"])} builder widget class(es) no served sheet defines:\n')
        for token in result['undefined']:
            sys.stderr.write(f'  - {token}\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
