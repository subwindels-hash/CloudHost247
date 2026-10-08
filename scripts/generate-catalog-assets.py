#!/usr/bin/env python3
"""The control-panel and operating-system mark families.

This is the only generator allowed to touch `panels/` and `operating-systems/`.
It is additive by default: `write()` leaves an existing file alone, so hand-tuned
artwork elsewhere in the library can never be flattened by running it. Two flags
opt into rewriting:

  --refresh-marks   rewrite the marks this script owns (the panel and
                    distribution families), which is how the 4-variant banks
                    were replaced with one distinct glyph per catalogue entry
  --emit-served     also write the copies the platform serves
                    (`frontend/public/{panel-logos,os-logos}`)

Why the served copies exist at all: the platform's catalogue stores a logo URL
per row, `AdminControlPanelsPage` documents that URL as `/panel-logos/<name>.svg`,
and `control-panels-api.test.ts` pins `/panel-logos/dokploy.svg`. Those paths were
serving genuine vendor artwork — the Ubuntu roundel, the cPanel wordmark, down to
the official brand hexes (`#DD4814`, `#FF6C2C`, `#A80030`) — which contradicts the
library's own published policy and would imply an affiliation with, or an
endorsement by, every vendor named. The marks below are CloudHost247's own line
art in CloudHost247's palette: one per entry so the catalogue stays glanceable,
and none of them a vendor's logo, wordmark or colour.

Nothing here is a support claim. `assets/images/cloudhost247/README.md` states the
rule: a mark existing is presentation only.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/images/cloudhost247'
SERVED = ROOT / 'cloudhost247-node/frontend/public'
INDEX = OUT / 'catalogue-marks.json'

# The 18 adapters that ship a working install path. Keep in step with
# `ls cloudhost247-node/src/control-panels/adapters/*.ts`.
PANEL_SLUGS = [
    'aapanel', 'adminbolt', 'cloudpanel', 'cloudron', 'coolify', 'cosmos', 'cpanel',
    'cyberpanel', 'directadmin', 'dokploy', 'easypanel', 'fastpanel', 'hestiacp',
    'kusanagi', 'plesk', 'tinycp', 'webmin', 'webuzo',
]

# The 12 public families seeded in migration 0041. `Unknown` is an internal placeholder
# for pre-existing servers whose distribution could not be determined, so it gets no
# public mark.
OS_SLUGS = [
    'almalinux', 'alpine-linux', 'arch-linux', 'centos', 'cloudlinux', 'debian',
    'fedora-cloud', 'kali-linux', 'nixos', 'opensuse', 'rocky-linux', 'ubuntu',
]

# Display names, because `slug.replace('-', ' ').title()` renders "Nixos" and
# "Opensuse" for two distributions whose names carry their own casing.
PANEL_NAMES = {
    'aapanel': 'aaPanel', 'adminbolt': 'AdminBolt', 'cloudpanel': 'CloudPanel',
    'cloudron': 'Cloudron', 'coolify': 'Coolify', 'cosmos': 'Cosmos',
    'cpanel': 'cPanel', 'cyberpanel': 'CyberPanel', 'directadmin': 'DirectAdmin',
    'dokploy': 'Dokploy', 'easypanel': 'Easypanel', 'fastpanel': 'FastPanel',
    'hestiacp': 'HestiaCP', 'kusanagi': 'Kusanagi', 'plesk': 'Plesk',
    'tinycp': 'TinyCP', 'webmin': 'Webmin', 'webuzo': 'Webuzo',
}
OS_NAMES = {
    'almalinux': 'AlmaLinux', 'alpine-linux': 'Alpine Linux', 'arch-linux': 'Arch Linux',
    'centos': 'CentOS', 'cloudlinux': 'CloudLinux', 'debian': 'Debian',
    'fedora-cloud': 'Fedora Cloud', 'kali-linux': 'Kali Linux', 'nixos': 'NixOS',
    'opensuse': 'openSUSE', 'rocky-linux': 'Rocky Linux', 'ubuntu': 'Ubuntu',
}

# Canonical file name -> served file name. Only the distributions diverge: the catalogue
# seeds `alpine`, `arch`, `fedora`, `kali` and `rocky`, while the theme registry resolves
# the longer names. Both are written from one definition so they cannot drift.
OS_SERVED_NAMES = {
    'alpine-linux': 'alpine', 'arch-linux': 'arch', 'fedora-cloud': 'fedora',
    'kali-linux': 'kali', 'rocky-linux': 'rocky',
}

INK = '#101e2c'
MINT = '#b4f2cd'
DEEP = '#196947'
PALE = '#ecf5ef'

# Every colour a mark in this family may use. Checked after generation, so a future edit
# cannot quietly reintroduce a vendor's brand hex — which is exactly how `#DD4814` (Ubuntu),
# `#FF6C2C` (cPanel) and `#A80030` (Debian) got into the served copies.
ALLOWED_COLOURS = {
    '#101e2c', '#b4f2cd', '#196947', '#ecf5ef',  # ink, mint, deep, pale
    '#132b37', '#183646', '#1b3444', '#08121a', '#28483f',  # plate faces and shadows
    '#365264', '#436272', '#68b996', '#79bda1', '#266758', '#b2c8d2',  # edges and text
}

# One glyph per panel, drawn in the rack's lower bay. Shared silhouette, distinct interior:
# that is what keeps eighteen entries distinguishable in a table at 28 px.
PANEL_GLYPHS = [
    '<circle cx="24" cy="30.2" r="4.6"/>',
    '<rect x="19.4" y="25.6" width="9.2" height="9.2" rx="2.2"/>',
    '<path d="M24 25.1 29.1 30.2 24 35.3 18.9 30.2Z"/>',
    '<path d="M20 33.2h8M24 25.2v14M20.6 27.3l6.8 5.8M27.4 27.3l-6.8 5.8"/>',
    '<path d="M24 25.4 30.4 35.6H17.6Z"/>',
    '<path d="M21.2 24.9h5.6l3.4 5.3-3.4 5.3h-5.6l-3.4-5.3Z"/>',
    '<path d="m17.8 26.6 5.4 5.4-5.4 5.4M24.4 26.6l5.4 5.4-5.4 5.4"/>',
    '<path d="M17.6 27.2h12.8M17.6 30.4h8.8M17.6 33.6h12.8"/>',
    '<circle cx="18.4" cy="30.4" r="1.5"/><circle cx="24" cy="30.4" r="1.5"/>'
    '<circle cx="29.6" cy="30.4" r="1.5"/>',
    '<circle cx="24" cy="30.4" r="3.4"/>'
    '<path d="M24 24.6v2.4M24 33.8v2.4M18.2 30.4h2.4M29.8 30.4h2.4"/>',
    '<path d="M17.6 30.4c1.6-3.4 3.2-3.4 4.8 0s3.2 3.4 4.8 0 3.2-3.4 4.8 0"/>',
    '<path d="M24 25.2 30.6 27.4v4.2c0 2.6-3 4.6-6.6 5.6-3.6-1-6.6-3-6.6-5.6v-4.2Z"/>',
    '<path d="M20.2 28.4a3.6 3.6 0 0 1 6.6-1.6 3.6 3.6 0 0 1 3.4 6.4H20.2a3.6 3.6 0 0 1 0-4.8Z"/>'
    '<path d="M18.4 35h11.2"/>',
    '<path d="M20.4 26.4h-2.4v8h2.4M27.6 26.4h2.4v8h-2.4"/>',
    '<circle cx="18.8" cy="30.4" r="2.6"/><circle cx="29.2" cy="30.4" r="2.6"/>'
    '<path d="M21.4 30.4h5.2"/>',
    '<path d="m24 25.2 7.2 3.5L24 32.2l-7.2-3.5Z"/><path d="m16.8 31.6 7.2 3.5 7.2-3.5"/>',
    '<path d="M24 24.8h3.2l2.2 2.2v3.2l-2.2 2.2H24l-2.2-2.2v-3.2Z"/>'
    '<circle cx="24" cy="28.6" r="1.6"/>',
    '<path d="M18 27.4h12M18 32.4h12M21.4 24.6v11M26.6 24.6v11"/>',
]

# One prompt per distribution, drawn inside the disc.
OS_PROMPTS = [
    '<path d="M16.5 20.8 21 25.2 16.5 29.6"/><path d="M24.5 29.6h7"/>',
    '<path d="M16.5 18.6h6.4M16.5 24h11M16.5 29.4h7.6"/>',
    '<path d="M17 21.4 21.6 26 17 30.6"/><path d="M24.6 21.4h6.8"/>',
    '<path d="M16.8 26h14.4"/><path d="M23.2 19.4 24.6 26l1.4 6.6"/>',
    '<path d="M17.4 20.2h13.2"/><path d="M17.4 27.8l5.2 5.2 6-11.6"/>',
    '<path d="m16.8 20.6 5 5-5 5M23.4 20.6l5 5-5 5"/>',
    '<path d="M19.6 18.6h-2.8v12.8h2.8M28.4 18.6h2.8v12.8h-2.8"/>'
    '<circle cx="24" cy="25" r="1.7"/>',
    '<circle cx="21" cy="24.4" r="4.6"/><circle cx="21" cy="24.4" r="1.2"/>'
    '<path d="M27.6 21.6h4.6M27.6 27.2h4.6"/>',
    '<circle cx="17.6" cy="24.4" r="1.5"/><circle cx="24" cy="24.4" r="1.5"/>'
    '<circle cx="30.4" cy="24.4" r="1.5"/><path d="M17.6 30.4h12.8"/>',
    '<path d="M24 17.4 31 29.4H17Z"/><path d="M19.4 32.4h9.2"/>',
    '<path d="M16.8 22.6h12.6M24.2 17.4l5.2 5.2-5.2 5.2"/><path d="M17.4 29.4h13.2"/>',
    '<path d="M19.4 18.6h9.2M19.4 24.6h9.2M22.2 16.6l-1.6 10M27.4 16.6l-1.6 10"/>'
    '<path d="M18.6 30.4h10.8"/>',
]


def svg(body, width, height, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img">'
        f'<title>{html.escape(title)}</title>{body}</svg>\n'
    )


def write(relative, body, width, height, title, overwrite=False):
    """Write one vector. Existing files are left alone unless `overwrite` is set."""
    path = OUT / (relative + '.svg')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not overwrite:
        return False
    path.write_text(svg(body, width, height, title), encoding='utf-8')
    return True


def variant(slug, count):
    """A stable index derived from the slug, so a mark never changes between runs."""
    return int(hashlib.sha256(slug.encode()).hexdigest()[:8], 16) % count


def panel_mark(glyph, colour=DEEP):
    """A slotted rack face carrying one of the panel glyphs.

    Every panel shares the rack silhouette and differs by the glyph inside the lower bay.
    Drawing a vendor's actual logo here would both misrepresent the licence position and
    make the catalogue impossible to extend without a designer.
    """
    body = (
        '<rect x="6.5" y="7.5" width="35" height="33" rx="5.5"/>'
        '<path d="M6.5 19h35"/>'
        '<path d="M12.5 13.2h4.2M20.3 13.2h2.4M30.5 13.2h3"/>'
        f'<g transform="translate(0,0)">{glyph}</g>'
    )
    return (
        f'<g fill="none" stroke="{colour}" stroke-width="1.9" '
        f'stroke-linecap="round" stroke-linejoin="round">{body}</g>'
    )


def os_mark(prompt, colour=DEEP):
    """A terminal prompt inside a disc.

    Deliberately not a distribution's wordmark, and deliberately not its colour: the
    catalogue pairs this with the name as text, and the geometry only has to make twelve
    rows distinguishable at 24 px.
    """
    return (
        f'<g fill="none" stroke="{colour}" stroke-width="1.9" '
        f'stroke-linecap="round" stroke-linejoin="round">'
        f'<circle cx="24" cy="24" r="16.6"/>{prompt}</g>'
    )


def catalogue_plate(x, y, label, active=False):
    """The isometric plate the wider library uses, so these pages sit in the same family."""
    top = '#28483f' if active else '#1b3444'
    edge = '#68b996' if active else '#436272'
    icon = (
        '<path d="M9 8v32M24 8v32M39 8v32"/>'
        '<rect x="5" y="15" width="8" height="8" rx="2" fill="#183646"/>'
        '<rect x="20" y="28" width="8" height="8" rx="2" fill="#183646"/>'
        '<rect x="35" y="13" width="8" height="8" rx="2" fill="#183646"/>'
    )
    return (
        f'<g transform="translate({x},{y})">'
        f'<ellipse cx="0" cy="65" rx="92" ry="32" fill="#08121a" opacity=".45"/>'
        f'<path d="m-80-5 80-45 80 45v40L0 80l-80-45Z" fill="#132b37" stroke="{edge}" stroke-width="1"/>'
        f'<path d="m-80-5 80 45 80-45M0 40v40" fill="none" stroke="{edge}"/>'
        f'<path d="m-80-5 80-45 80 45L0 40Z" fill="{top}" stroke="{edge}"/>'
        f'<g transform="translate(-24,-27)"><g fill="none" stroke="{MINT}" stroke-width="1.8" '
        f'stroke-linecap="round" stroke-linejoin="round">{icon}</g></g>'
        f'<circle cx="53" cy="30" r="3" fill="{MINT}"/>'
        f'<text x="0" y="109" text-anchor="middle" fill="#b2c8d2" font-size="10" '
        f'font-family="DejaVu Sans,Arial,sans-serif" letter-spacing="1.4">{html.escape(label.upper())}</text>'
        '</g>'
    )


def catalogue_hub(caption):
    grid = (
        '<defs><radialGradient id="glow"><stop stop-color="#266758" stop-opacity=".3"/>'
        '<stop offset="1" stop-color="#101e2c" stop-opacity="0"/></radialGradient></defs>'
        '<ellipse cx="345" cy="270" rx="310" ry="265" fill="url(#glow)"/>'
    )
    for index in range(9):
        grid += (
            f'<path d="M{30 + index * 60} 70 {630 - index * 15} 460'
            f'M{30 + index * 60} 460 {630 - index * 15} 70" '
            'stroke="#365264" stroke-width=".7" opacity=".23"/>'
        )
    grid += (
        '<g stroke="#79bda1" fill="none" stroke-dasharray="4 7">'
        '<path d="M140 130 330 230 490 360M330 230 150 385M140 130 490 360"/></g>'
    )
    grid += catalogue_plate(140, 120, 'Server')
    grid += catalogue_plate(490, 345, 'Application')
    grid += catalogue_plate(330, 235, 'Control panel', active=True)
    grid += (
        '<text x="72" y="485" fill="#b4f2cd" font-size="11" '
        'font-family="DejaVu Sans,Arial,sans-serif" letter-spacing="2">'
        f'CH247 / {html.escape(caption.upper())}</text>'
    )
    return grid


def guard_banks():
    """Distinctness is by construction, so it is asserted rather than hoped for."""
    if len(set(PANEL_GLYPHS)) != len(PANEL_GLYPHS):
        sys.exit('panel glyph bank contains a duplicate: two panels would render the same mark')
    if len(set(OS_PROMPTS)) != len(OS_PROMPTS):
        sys.exit('OS prompt bank contains a duplicate: two distributions would render the same mark')
    if len(PANEL_GLYPHS) < len(PANEL_SLUGS):
        sys.exit(f'panel glyph bank has {len(PANEL_GLYPHS)} glyphs for {len(PANEL_SLUGS)} panels')
    if len(OS_PROMPTS) < len(OS_SLUGS):
        sys.exit(f'OS prompt bank has {len(OS_PROMPTS)} prompts for {len(OS_SLUGS)} distributions')


def guard_palette():
    """No mark may use a colour from outside the CloudHost247 palette."""
    offenders = []
    for relative in [f'panels/{slug}' for slug in PANEL_SLUGS] + [
        f'operating-systems/{slug}' for slug in OS_SLUGS
    ]:
        path = OUT / (relative + '.svg')
        for colour in re.findall(r'#[0-9A-Fa-f]{6}', path.read_text(encoding='utf-8')):
            if colour.lower() not in ALLOWED_COLOURS:
                offenders.append(f'{relative}.svg uses {colour}')
    if offenders:
        sys.exit('mark palette guard failed:\n  ' + '\n  '.join(sorted(set(offenders))))


def emit_served_marks():
    """Write the copies the platform serves, from the same definition as the canonical set."""
    written = 0
    index = []
    for slug in PANEL_SLUGS:
        path = SERVED / 'panel-logos' / f'{slug}.svg'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text((OUT / f'panels/{slug}.svg').read_text(encoding='utf-8'), encoding='utf-8')
        written += 1
        index.append({'family': 'control-panel', 'slug': slug, 'title': PANEL_NAMES[slug],
                      'canonical': f'assets/images/cloudhost247/panels/{slug}.svg',
                      'served': f'/panel-logos/{slug}.svg'})
    for slug in OS_SLUGS:
        served_name = OS_SERVED_NAMES.get(slug, slug)
        path = SERVED / 'os-logos' / f'{served_name}.svg'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text((OUT / f'operating-systems/{slug}.svg').read_text(encoding='utf-8'),
                        encoding='utf-8')
        written += 1
        index.append({'family': 'operating-system', 'slug': slug, 'title': OS_NAMES[slug],
                      'canonical': f'assets/images/cloudhost247/operating-systems/{slug}.svg',
                      'served': f'/os-logos/{served_name}.svg'})
    return written, index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-marks', action='store_true',
                        help='rewrite the panel and distribution marks this script owns')
    parser.add_argument('--emit-served', action='store_true',
                        help='also write the copies the platform serves under frontend/public')
    options = parser.parse_args()

    guard_banks()

    written = 0
    for slug, glyph in zip(PANEL_SLUGS, PANEL_GLYPHS):
        written += write(f'panels/{slug}', panel_mark(glyph), 48, 48, PANEL_NAMES[slug],
                         overwrite=options.refresh_marks)
    for slug, prompt in zip(OS_SLUGS, OS_PROMPTS):
        written += write(f'operating-systems/{slug}', os_mark(prompt), 48, 48, OS_NAMES[slug],
                         overwrite=options.refresh_marks)

    # The two catalogue hubs, in the same isometric family as the product art. `os-catalog.svg`
    # already exists and is referenced by the registry page, so the hub is written under its own
    # name rather than overwriting an asset the theme resolves by key.
    written += write('panels/control-panel-catalogue', catalogue_hub('Control panel catalogue'),
                     660, 560, 'CloudHost247 control panel catalogue')
    written += write('operating-systems/os-catalogue', catalogue_hub('Operating system catalogue'),
                     660, 560, 'CloudHost247 operating system catalogue')

    guard_palette()

    served = 0
    index = []
    if options.emit_served:
        served, index = emit_served_marks()
        INDEX.write_text(json.dumps({
            'note': 'Generated by scripts/generate-catalog-assets.py. One CloudHost247 mark per '
                    'catalogue entry, served from the platform under the path its API stores.',
            'marks': index,
        }, indent=2) + '\n', encoding='utf-8')

    total = len(list(OUT.rglob('*.*')))
    print(f'catalogue marks: {written} written, {served} served, {total} files in library')


if __name__ == '__main__':
    main()
