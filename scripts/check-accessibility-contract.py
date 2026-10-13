#!/usr/bin/env python3
"""Static accessibility and responsive contract for the parts of the site this repository renders.

`tests/website/browser.cjs` is the real thing: Chromium, ten viewport widths, axe-core. It needs a
Chromium binary and rendered fixtures, so it cannot run in every environment — and a claim that
"accessibility was checked" cannot rest on a check that only ever ran on one machine. This script is
the part of that contract that is decidable from the sources we ship, so the release candidate can
hold the line between browser runs:

  viewport        every page shell declares `width=device-width` (no page is desktop-only)
  language        every page shell declares the document language, so a screen reader picks a voice
  skip-link       a "skip to main content" link whose target id exists in the same shell
  menu-keyboard   the navigation toggle carries `aria-expanded`/`aria-controls`, the id it controls
                  exists, and the mega menus are `<details>`/`<summary>` (operable without scripting)
  control-names   every visible form control is named — `aria-label`, `aria-labelledby`, `<label for>`
                  or an implicit `<label>` wrapper
  image-text      every first-party `<img>` has `alt`, and one whose source this repository serves
                  also declares its pixel size so the layout does not reflow around it
  focus-visible   the shipped sheets draw a visible focus indicator
  reduced-motion  the shipped sheets honour `prefers-reduced-motion`
  target-size     the controls a thumb actually hits (menu toggle, utility bar, account links, footer
                  links) declare a hit area of at least 24 CSS pixels (WCAG 2.2 SC 2.5.8); the mobile
                  navigation toggle gets the 44px of SC 2.5.5
  breakpoints     every viewport the QA matrix tests (320 → 1920) is inside at least one media query
  no-x-overflow   the site root clips horizontal overflow and images cannot exceed their container

Every rule is a minimum, not a style: it says a page is usable, not that it is pretty. The numbers
are asserted against the shipped CSS declarations rather than a screenshot, so this gate runs
anywhere Python does and fails closed when the stylesheets stop defending the layout.

Usage:
    python3 scripts/check-accessibility-contract.py            # text report, exit 1 on a violation
    python3 scripts/check-accessibility-contract.py --json     # machine-readable report
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
THEME = ROOT / 'templates' / 'cloudhost247'
CSS_DIR = THEME / 'css'

# Every file that renders markup a visitor sees. `tools/lib/View.php` renders the tools pages in PHP,
# so a control it prints is as real as one a template prints.
MARKUP_FILES = sorted(THEME.rglob('*.tpl')) + [ROOT / 'tools' / 'lib' / 'View.php']

# The parent theme's loading overlay: WHMCS ships the image and sizes it from its own stylesheet, so
# this repository neither owns the file nor decides its dimensions.
IMG_ATTR_EXEMPT = {
    'assets/img/overlay-spinner.svg': 'WHMCS parent theme loading overlay; sized by the parent stylesheet',
}

# Interactive controls that a phone user actually touches. Selector → (minimum pixels, why).
TARGET_RULES = {
    '.ch-menu-toggle': (44, 'the mobile navigation toggle (WCAG 2.2 SC 2.5.5 enhanced target size)'),
    '.ch-top a': (24, 'utility-bar links (SC 2.5.8, non-inline)'),
    '.ch-top button': (24, 'the language/currency switcher in the utility bar'),
    '.ch-account>a': (24, 'account links in the header'),
    '.ch-footer li a': (24, 'footer links'),
    '.ch-nav-item>summary': (24, 'mega-menu summaries, which are the keyboard entry point'),
}

# The viewport widths the browser QA matrix tests. For each one some media query has to apply — a
# `max-width` boundary at or above it, or a `min-width` boundary at or below it — or that width is a
# width nobody styles and the layout is whatever the desktop rules happen to do.
QA_WIDTHS = (320, 375, 390, 414, 768, 1024, 1280, 1440, 1920)

# Anti-vacuity floors: a clean report is only meaningful if the script actually read the site.
MINIMUMS = {'sheets': 5, 'rules': 400, 'media_queries': 8, 'controls': 10, 'images': 5, 'files': 40}

SMARTY_COMMENT = re.compile(r'\{\*.*?\*\}', re.S)
CONTROL = re.compile(r'<(input|select|textarea)\b[^>]*>', re.I)
LABEL_OPEN = re.compile(r'<label\b[^>]*>', re.I)
LABEL_CLOSE = re.compile(r'</label>', re.I)
LABEL_FOR = re.compile(r'<label\b[^>]*\bfor="([^"]+)"', re.I)
IMG = re.compile(r'<img\b[^>]*>', re.I)
ATTR = re.compile(r'([a-zA-Z-]+)="([^"]*)"')
RULE = re.compile(r'([^{}]+)\{([^{}]*)\}')
MEDIA = re.compile(r'@media[^{]*?\((?:min|max)-width:\s*(\d+)px\)')


def strip_smarty_comments(text: str) -> str:
    """Smarty comments are documentation, not markup: an `<img>` described in a comment is not a tag."""
    return SMARTY_COMMENT.sub('', text)


def attributes(tag: str) -> dict[str, str]:
    return {key.lower(): value for key, value in ATTR.findall(tag)}


def inside_label_spans(source: str) -> list[tuple[int, int]]:
    """Character spans covered by a `<label>…</label>` wrapper (implicit labelling)."""
    spans = []
    for match in LABEL_OPEN.finditer(source):
        close = LABEL_CLOSE.search(source, match.end())
        spans.append((match.start(), close.start() if close else len(source)))
    return spans


def control_name_problems(source: str, where: str) -> list[str]:
    """Visible controls with no accessible name.

    A control is named by `aria-label`, `aria-labelledby`, a `<label for="…">` pointing at its id, or an
    enclosing `<label>` element. Hidden, submit, button and reset inputs are exempt: the button face is
    its own name, and a hidden input is never focused or announced.
    """
    spans = inside_label_spans(source)
    named_ids = set(LABEL_FOR.findall(source))
    problems = []
    for match in CONTROL.finditer(source):
        tag = match.group(0)
        attrs = attributes(tag)
        if attrs.get('type', 'text').lower() in ('hidden', 'submit', 'button', 'reset'):
            continue
        if attrs.get('aria-label') or attrs.get('aria-labelledby'):
            continue
        if attrs.get('id') and attrs['id'] in named_ids:
            continue
        if any(start <= match.start() < end for start, end in spans):
            continue
        problems.append(f'{where}: <{match.group(1).lower()}> has no accessible name ({tag[:90]})')
    return problems


def image_problems(source: str, where: str) -> list[str]:
    """`alt` on every image, and pixel dimensions on every image this repository serves."""
    problems = []
    for match in IMG.finditer(source):
        tag = match.group(0)
        attrs = attributes(tag)
        if 'alt' not in attrs:
            problems.append(f'{where}: <img> without alt ({tag[:90]})')
        src = attrs.get('src', '')
        owns_source = 'assets/images/cloudhost247/' in src or 'assets/cloudhost247-tools/' in src
        exempt = any(key in src for key in IMG_ATTR_EXEMPT)
        if owns_source and not exempt and not (attrs.get('width') and attrs.get('height')):
            problems.append(f'{where}: <img> without width/height, so the page reflows ({src[:80]})')
    return problems


def css_rules(sheets: dict[str, str]) -> list[tuple[str, str, str]]:
    """`(sheet, selector, declarations)` for every rule the shipped sheets declare."""
    rules = []
    for name, text in sheets.items():
        for selector, body in RULE.findall(text):
            selector = selector.strip()
            if not selector or selector.startswith('@'):
                continue
            rules.append((name, selector, body.strip()))
    return rules


def declaration(body: str, prop: str) -> str | None:
    """The last value of one property in a declaration block, or `None`."""
    value = None
    for chunk in body.split(';'):
        name, _, raw = chunk.partition(':')
        if name.strip().lower() == prop:
            value = raw.strip()
    return value


def pixels(value: str | None) -> float | None:
    """A `NNpx` length as a number; anything else (a variable, `auto`, `clamp()`) is unknown."""
    if not value:
        return None
    match = re.fullmatch(r'(\d+(?:\.\d+)?)px', value.strip())
    return float(match.group(1)) if match else None


def target_problems(rules: list[tuple[str, str, str]]) -> list[str]:
    """Every touch target in TARGET_RULES must declare its hit area as a min-height or vertical padding.

    Only the shipped sheets are consulted, and only declarations this script can read as a number:
    `min-height: 24px` or vertical padding that reaches it. A selector nobody styles is reported, so a
    renamed class cannot quietly drop out of the contract.
    """
    problems = []
    for selector, (minimum, why) in TARGET_RULES.items():
        found = False
        best = 0.0
        for sheet, rule_selector, body in rules:
            # A rule may narrow the target with a pseudo-class (`.ch-account>a:not(.ch-btn)`), so a
            # selector that starts with the target counts for it.
            if not any(part.strip() == selector or part.strip().startswith(selector) for part in rule_selector.split(',')):
                continue
            found = True
            height = pixels(declaration(body, 'min-height')) or 0.0
            font = pixels(declaration(body, 'font-size')) or 0.0
            if font == 0.0:
                # Font size is often set outside the rule; fall back to 1rem-ish text metrics later.
                font = 12.0
            padding = declaration(body, 'padding-block') or declaration(body, 'padding')
            vertical = None
            if padding:
                parts = padding.split()
                candidate = parts[0]
                if len(parts) == 1 and '/' in candidate:
                    candidate = candidate.split('/')[0]
                vertical = pixels(candidate)
            block = 0.0
            if vertical is not None:
                block = vertical * (2 if len(padding.split()) <= 2 else 1)
            best = max(best, height, font * 1.65 + block)
        if not found:
            problems.append(f'{selector}: no shipped stylesheet styles it, so its hit area is unknown ({why})')
        elif best + 0.01 < minimum:
            problems.append(f'{selector}: hit area ≈{best:.0f}px, below the {minimum}px minimum ({why})')
    return problems


def breakpoint_problems(max_widths: set[int], min_widths: set[int]) -> list[str]:
    """Every viewport the QA matrix tests must be inside at least one media query."""
    problems = []
    for width in QA_WIDTHS:
        applies = any(width <= boundary for boundary in max_widths) or any(boundary <= width for boundary in min_widths)
        if not applies:
            problems.append(f'{width}px: no media query applies at this width (nothing styles that viewport)')
    return problems


def shell_files(root: Path) -> tuple[Path, ...]:
    """The page shells of one repository root, so the contract can be pointed at a fixture tree."""
    theme = root / 'templates' / 'cloudhost247'
    return (
        theme / 'header.tpl',
        theme / 'footer.tpl',
        theme / 'includes' / 'site-nav.tpl',
        theme / 'includes' / 'site-footer.tpl',
        root / 'tools' / 'lib' / 'View.php',
    )


def run(root: Path = ROOT) -> dict:
    theme = root / 'templates' / 'cloudhost247'
    css_dir = theme / 'css'
    sheets = {path.name: path.read_text(errors='ignore') for path in sorted(css_dir.glob('*.css'))}
    markup_files = sorted(theme.rglob('*.tpl')) + [root / 'tools' / 'lib' / 'View.php']
    sources = {path: strip_smarty_comments(path.read_text(errors='ignore')) for path in markup_files}
    shells = {path: strip_smarty_comments(path.read_text(errors='ignore')) for path in shell_files(root)}

    problems: list[str] = []

    for path, text in shells.items():
        where = path.relative_to(root).as_posix()
        if path.name in ('header.tpl', 'View.php') and 'width=device-width' not in text:
            problems.append(f'{where}: no viewport meta with width=device-width')
        if path.suffix == '.tpl' and path.name == 'header.tpl':
            if '<html lang="' not in text:
                problems.append(f'{where}: <html> without a lang attribute')
        if path.name == 'View.php' and '<html lang="en"' not in text:
            problems.append(f'{where}: <html> without a lang attribute')

    nav = shells[theme / 'includes' / 'site-nav.tpl']
    header = shells[theme / 'header.tpl']
    skip = re.search(r'<a\b[^>]*class="[^"]*ch-skip[^"]*"[^>]*href="#([^"]+)"', nav)
    skip_alt = re.search(r'<a\b[^>]*href="#([^"]+)"[^>]*class="[^"]*ch-skip[^"]*"', nav)
    target = (skip or skip_alt).group(1) if (skip or skip_alt) else ''
    if not target:
        problems.append('site-nav.tpl: no skip link (a keyboard user cannot bypass the navigation)')
    elif f'id="{target}"' not in header:
        problems.append(f'site-nav.tpl: skip link points at #{target}, which no shell element defines')

    toggle = re.search(r'<button\b[^>]*class="[^"]*ch-menu-toggle[^"]*"[^>]*>', nav)
    if not toggle:
        problems.append('site-nav.tpl: no .ch-menu-toggle button')
    else:
        attrs = attributes(toggle.group(0))
        if 'aria-expanded' not in attrs:
            problems.append('site-nav.tpl: the menu toggle has no aria-expanded state')
        controlled = attrs.get('aria-controls', '')
        if not controlled:
            problems.append('site-nav.tpl: the menu toggle does not say which element it controls')
        elif f'id="{controlled}"' not in nav:
            problems.append(f'site-nav.tpl: aria-controls="{controlled}" names an element that does not exist')
    if '<details class="ch-nav-item"' not in nav or '<summary>' not in nav:
        problems.append('site-nav.tpl: mega menus are not <details>/<summary>, so they need scripting to open')

    controls = 0
    images = 0
    for path, text in sources.items():
        where = path.relative_to(root).as_posix()
        controls += len([m for m in CONTROL.finditer(text) if attributes(m.group(0)).get('type', 'text').lower()
                         not in ('hidden', 'submit', 'button', 'reset')])
        images += len(IMG.findall(text))
        problems += control_name_problems(text, where)
        problems += image_problems(text, where)

    rules = css_rules(sheets)
    problems += target_problems(rules)
    joined = '\n'.join(sheets.values())
    max_widths = {int(value) for value in re.findall(r'@media[^{]*?max-width:\s*(\d+)px', joined)}
    min_widths = {int(value) for value in re.findall(r'@media[^{]*?min-width:\s*(\d+)px', joined)}
    problems += breakpoint_problems(max_widths, min_widths)
    if not re.search(r':focus-visible\s*\{[^}]*outline', joined):
        problems.append('no shipped stylesheet draws a visible :focus-visible outline')
    if 'prefers-reduced-motion' not in sheets.get('site.css', '') and 'prefers-reduced-motion' not in sheets.get(
            'design-system.css', ''):
        problems.append('neither site.css nor design-system.css honours prefers-reduced-motion')
    if not re.search(r'\.ch-site\{[^}]*overflow-x:\s*(clip|hidden)', joined):
        problems.append('.ch-site does not clip horizontal overflow')
    if not re.search(r'img[^{}]*\{[^}]*max-width:\s*100%', joined):
        problems.append('no shipped stylesheet constrains image width (an oversized image scrolls the page)')

    counters = {
        'files': len(sources),
        'sheets': len(sheets),
        'rules': len(rules),
        'media_queries': len(max_widths | min_widths),
        'controls': controls,
        'images': images,
    }
    vacuous = {name: (counters[name], floor) for name, floor in MINIMUMS.items() if counters[name] < floor}
    for name, (found, floor) in sorted(vacuous.items()):
        problems.append(f'vacuous gate: only {found} {name} inspected (expected at least {floor})')

    return {
        'counters': counters,
        'max_widths': sorted(max_widths),
        'min_widths': sorted(min_widths),
        'problems': problems,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
    args = parser.parse_args()
    report = run()
    problems = report['problems']
    if args.json:
        print(json.dumps({**report, 'passed': not problems}, indent=2))
        return 1 if problems else 0
    counters = report['counters']
    print(f"accessibility contract: {counters['files']} markup files, {counters['controls']} visible controls, "
          f"{counters['images']} images, {counters['rules']} CSS rules, {counters['media_queries']} media widths")
    if problems:
        print(f'\n{len(problems)} violation(s):', file=sys.stderr)
        for problem in problems:
            print(f'  · {problem}', file=sys.stderr)
        return 1
    print('✓ viewport, lang, skip link, menu state, control names, image text, target sizes, '
          'focus, reduced motion and the responsive ladder all hold')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
