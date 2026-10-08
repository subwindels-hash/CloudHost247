#!/usr/bin/env python3
"""Generate the control-panel and operating-system mark families.

Additive by design. `scripts/generate-website-assets.py` owns the full library, but its
product illustrations were hand-tuned after the last run, so re-running it would flatten
that work back to the generic composition. This script therefore writes **only** the two
families that were previously empty, and never rewrites an existing file it did not
create. Run it to add a mark for a panel or distribution that has just been added to the
catalogue; it is idempotent.

The catalogue itself is published by the platform, not by this file:

  * control panels  — cloudhost247-node/src/control-panels/adapters/*.ts (the adapters that
                      ship an install path, firewall rules and capability set)
  * operating systems — cloudhost247-node/database/migrations/0041_*.sql (the seeded
                      `operating_systems` catalogue)

What is generated here is the *neutral visual family* those live records render beside
when no operator-supplied logo has been uploaded. No vendor logo is drawn, traced,
bundled or implied: each mark is original geometry, and the panel or distribution name is
rendered as text next to it. That matches the policy `ApplicationLogo` already applies to
applications and keeps the asset library free of marks this project has no licence to
ship. A mark existing here is *presentation only* and is not a claim that a panel or
distribution is provisionable — the API decides that.
"""
from pathlib import Path
import hashlib, html

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/images/cloudhost247'

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

INK = '#101e2c'
MINT = '#b4f2cd'
DEEP = '#196947'
PALE = '#ecf5ef'


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


def panel_mark(slug, colour=DEEP):
    """A slotted rack face carrying one of four original glyphs.

    Two independent axes keep the family coherent but glanceable: every panel shares the
    rack silhouette, and the glyph inside the lower bay varies by slug. Drawing a vendor's
    actual logo here would both misrepresent the licence position and make the catalogue
    impossible to extend without a designer.
    """
    glyph = [
        '<circle cx="24" cy="30.5" r="4.6"/>',
        '<rect x="19.4" y="25.9" width="9.2" height="9.2" rx="2.2"/>',
        '<path d="M24 25.4 29.1 30.5 24 35.6 18.9 30.5Z"/>',
        '<path d="M20 33.5h8M24 25.5v14M20.6 27.6l6.8 5.8M27.4 27.6l-6.8 5.8"/>',
    ][variant(slug, 4)]
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


def os_mark(slug, colour=DEEP):
    """A terminal prompt inside a disc, with the prompt rhythm varying by slug.

    Deliberately not a distribution's wordmark: the catalogue pairs this with the name as
    text, and the geometry only has to make twelve rows distinguishable at 24 px.
    """
    prompt = [
        '<path d="M16.5 20.8 21 25.2 16.5 29.6"/><path d="M24.5 29.6h7"/>',
        '<path d="M16.5 18.6h6.4M16.5 24h11M16.5 29.4h7.6"/>',
        '<path d="M17 21.4 21.6 26 17 30.6"/><path d="M24.6 21.4h6.8"/>',
        '<path d="M16.8 26h14.4"/><path d="M23.2 19.4 24.6 26l1.4 6.6"/>',
    ][variant(slug, 4)]
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


def main():
    written = 0
    for slug in PANEL_SLUGS:
        written += write(f'panels/{slug}', panel_mark(slug), 48, 48, slug.replace('-', ' ').title())
    for slug in OS_SLUGS:
        written += write(f'operating-systems/{slug}', os_mark(slug), 48, 48, slug.replace('-', ' ').title())

    # The two catalogue hubs, in the same isometric family as the product art. `os-catalog.svg`
    # already exists and is referenced by the registry page, so the hub is written under its own
    # name rather than overwriting an asset the theme resolves by key.
    written += write('panels/control-panel-catalogue', catalogue_hub('Control panel catalogue'),
                     660, 560, 'CloudHost247 control panel catalogue')
    written += write('operating-systems/os-catalogue', catalogue_hub('Operating system catalogue'),
                     660, 560, 'CloudHost247 operating system catalogue')

    total = len(list(OUT.rglob('*.*')))
    print(f'catalogue marks: {written} written, {total} files in library')


if __name__ == '__main__':
    main()
