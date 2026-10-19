"""Appearance rules the rendered-site audit cannot see, each with the check that keeps it true.

Two defect classes were found on 2026-10-16 by comparing the shipped tree with the last
known-good revision. Both changed what a visitor sees on a live page, and neither was visible to
any gate in the repository: the rendered-site audit checks that every image reference *resolves*,
not which artwork it resolves to, and it never looks at a cache-busting query string.

1. **Card icons switching artwork family.** `scripts/site/generate.mjs` builds
   `contentIconAssets()` as one index keyed by file *basename* across every family directory under
   `assets/images/cloudhost247/`, and lets the flat `icons/` family win a tie ("the icon family is
   the one drawn for cards"). Adding `icons/firewall.svg` and `icons/network.svg` therefore
   repointed twelve card slots — eleven published pages — from the isometric artwork those pages
   shipped with (`management/firewall.svg`, `cloud/network.svg`, both 660×560, transparent) to a
   48px glyph carrying its own opaque `#ecf5ef` rounded square. Inside the 42px light
   `.ch-card__icon` tile that renders it, that is a tile inside a tile; and the hero on the very
   same page kept the old artwork. The two shadowing files were removed and the registry
   regenerated, so the twelve slots are the reviewed artwork again.

   `test_no_used_icon_is_shadowed_by_another_family` generalises the rule: no name that a card
   icon is drawn from may exist in more than one family beyond the baseline set recorded below.
   A future pass that adds `icons/<name>.svg` for an artwork name fails here, with the generator
   rule named, instead of silently restyling the page.

2. **Stylesheets served under a stamp that no longer matched the file.** The theme links
   `site.css`, `design-system.css`, `site.js` and the tools shell's `tools.css`/`tools.js` with a
   `?v=` cache-busting stamp, and the repository has bumped it deliberately before
   ("fix(deploy): bump asset versions to 20261007 to force cache invalidation after 3D visual
   system update"). Four of those five files were then edited between 2026-10-11 and 2026-10-16
   without the stamp moving, so a returning visitor kept the pre-change stylesheet against
   post-change markup — the appearance the file on disk does not describe, for as long as the
   browser and any intermediary cache hold it.

   `test_cache_busting_stamps_track_their_assets` pins each (stamp, digest) pair. Changing an
   asset without moving its stamp fails; moving the stamp without re-cutting these pins fails
   too, so the next bump is a deliberate, reviewed act rather than a silent one.
"""

from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets' / 'images' / 'cloudhost247'
SITE_JSON = ROOT / 'modules' / 'addons' / 'cloudhost247_theme' / 'resources' / 'site.json'
SITE_HEAD = ROOT / 'templates' / 'cloudhost247' / 'includes' / 'site-head.tpl'
TOOLS_SHELL = ROOT / 'templates' / 'cloudhost247' / 'cloudhost247-tools.tpl'

# The eleven pages whose card slots use one of the two artwork names that were shadowed.
# Reviewed baseline: every one of these is the 660x560 isometric scene, not a flat icon.
REVIEWED_CARD_ARTWORK = {
    'vps-hosting.php': ['management/firewall.svg'],
    'vps-privatecloud.php': ['cloud/network.svg'],
    'vps-publiccloud.php': ['management/firewall.svg'],
    'cloudhost247-hosting.php': ['cloud/network.svg', 'management/firewall.svg'],
    'server-management.php': ['management/firewall.svg'],
    'infrastructure.php': ['cloud/network.svg'],
    'data-centers.php': ['cloud/network.svg'],
    'network.php': ['management/firewall.svg'],
    'monitoring.php': ['cloud/network.svg'],
    'firewall.php': ['management/firewall.svg'],
    'managed-services.php': ['management/firewall.svg'],
}

# `icons/` is the one family `contentIconAssets()` lets win a basename tie, so a file there
# shadows every other family with the same name. A card icon must therefore never be drawn from
# a family that `icons/` shadows: no icons name may be shared with the path a page renders.
# Names shared between two *artwork* families (applications/deployment, management/tools,
# cloud/tools) are not this defect — they predate the rule and render from the family the
# registry names.

# (stamp, sha256) per stamped asset. Re-cut this table when an asset changes *and* the stamp in
# the template moves with it; the test's failure message says which of the two is out of step.
CACHE_BUSTING_STAMPS = {
    'templates/cloudhost247/css/site.css': (
        '20261019', 'fa282fb10dcffe4229266f80660d34e5c9891a1973233d974435c0616d81d3c2'),
    'templates/cloudhost247/css/design-system.css': (
        '20261016', 'b30a85ef92edc71c3d2e14fa5c8ef96aa929e1b870b578ae023b34d0b4637f4e'),
    'templates/cloudhost247/js/site.js': (
        '20261016', '4bf8557df4b9458075ee962bd7a3bb9272f6e5c2ea2b82ab5c5a755e8126237f'),
    'templates/cloudhost247/css/tools.css': (
        '20261019', '1ac4993a44953755165b69c6d7907fd789d675c857884464035103db6974763c'),
    # The sign-in, registration and password-recovery sheet. Pinned too: it is the one file every
    # account page depends on, so an edit that does not move its stamp is the failure this table
    # exists to catch.
    'templates/cloudhost247/css/auth.css': (
        '20261019', 'a93eb017f76d88399e5945ef61cc647c258ba14bb0bb2291fb86bede357ac969'),
    'templates/cloudhost247/js/tools.js': (
        '20261016', 'c15666bec6bbf61b2f0317e69138c42cbe56992daaad9b767ff624c483544ee2'),
}


def site_registry() -> dict:
    return json.loads(SITE_JSON.read_text(encoding='utf-8'))


def used_icons(registry: dict) -> set[str]:
    """Every `icon` value the PHP registry asks a page to render."""
    found: set[str] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key == 'icon' and isinstance(value, str) and value:
                    found.add(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for entry in node:
                walk(entry)

    walk(registry)
    return found




def stamp_for(asset: str) -> str:
    """The `?v=` stamp the theme serves `asset` under, read from the template that links it."""
    template = SITE_HEAD if 'tools.' not in Path(asset).name else TOOLS_SHELL
    text = template.read_text(encoding='utf-8')
    name = re.escape(Path(asset).name)
    match = re.search(rf'{name}\?v=(\d+)', text)
    assert match is not None, f'{template.name} no longer links {asset} with a ?v= stamp'
    return match.group(1)


class CardIconArtworkTests(unittest.TestCase):
    def test_every_registry_icon_resolves_to_a_file(self):
        registry = site_registry()
        missing = sorted(
            icon for icon in used_icons(registry) if not (ASSETS / icon).is_file()
        )
        self.assertEqual(missing, [], f'registry icons with no file under {ASSETS}')

    def test_reviewed_card_artwork_is_still_the_artwork(self):
        registry = site_registry()
        for page, expected in REVIEWED_CARD_ARTWORK.items():
            sections = registry['pages'][page].get('sections', [])
            rendered = sorted(
                item['icon']
                for section in sections
                for item in section.get('items', [])
                if item.get('icon', '').rsplit('/', 1)[-1] in {'firewall.svg', 'network.svg'}
            )
            self.assertEqual(
                rendered,
                sorted(expected),
                f'{page} no longer renders its reviewed card artwork; if the flat `icons/` '
                'family is intended here, that is a deliberate change — record it in '
                'REVIEWED_CARD_ARTWORK together with the reason, do not let it happen by '
                'adding a file whose name shadows the artwork.',
            )

    def test_no_card_icon_is_shadowed_by_the_icons_family(self):
        icons_family = {asset.stem for asset in (ASSETS / 'icons').glob('*.svg')}
        shadowed = sorted(
            icon for icon in used_icons(site_registry())
            if Path(icon).stem in icons_family and not icon.startswith('icons/')
        )
        self.assertEqual(
            shadowed,
            [],
            'A file in the `icons/` family now shares its name with an icon a card renders from '
            'another family, so the next generated registry silently switches that artwork: '
            '`contentIconAssets()` in scripts/site/generate.mjs always lets `icons/` win a '
            'basename tie, which is how eleven pages changed on 2026-10-15 '
            '(`icons/firewall.svg` and `icons/network.svg` replaced `management/firewall.svg` '
            'and `cloud/network.svg`). Delete the shadowing file, or rename it — do not leave '
            'the mapping to depend on which files happen to exist.',
        )


class ReviewedPageCopyTests(unittest.TestCase):
    """Copy the same commit replaced with less specific text, pinned so it cannot drift silently.

    `backups.php` carried a list of what backups are for; `18246b6` replaced it with the generic
    "New projects / Migrations / Teams standardizing on one provider" list that fourteen other
    pages already shared. `dns-management.php` and `domain-dns.php` lost the meta descriptions
    authored for them (`Site.php` prefers a page's `seo_description` over its `summary` for exactly
    this reason). All three are data, not templates, so no rendered-page gate could see them.
    """

    def test_backups_page_keeps_its_authored_copy(self):
        page = site_registry()['pages']['backups.php']
        self.assertEqual(
            page.get('uses'),
            ['Your own copy of critical data', 'A tested recovery plan',
             'A version control system for code'],
            'backups.php no longer carries its authored list. It is the legacy-renderer fallback '
            '(`ch247Site.page.uses` renders only where a page has no sections), so a change here '
            'is invisible in the fixtures and has to be deliberate.',
        )

    def test_authored_meta_descriptions_are_not_dropped(self):
        registry = site_registry()
        for page, expected in {
            'dns-management.php':
                'Where authoritative DNS records for CloudHost247-hosted domains are edited, and '
                'what the read-only diagnostic tools can and cannot tell you.',
            'domain-dns.php':
                'Where nameserver and DNS record changes are made for a registered domain, and '
                'what can be checked without editing the zone.',
        }.items():
            with self.subTest(page=page):
                self.assertEqual(
                    registry['pages'][page].get('seo_description'),
                    expected,
                    f'{page} lost the description authored for it; `Site::context` falls back to '
                    'the page summary, which is how nineteen near-identical descriptions happened '
                    'before (lib/Site.php).',
                )


class CacheBustingTests(unittest.TestCase):
    def test_cache_busting_stamps_track_their_assets(self):
        for asset, (stamp, digest) in CACHE_BUSTING_STAMPS.items():
            with self.subTest(asset=asset):
                served = stamp_for(asset)
                actual = hashlib.sha256((ROOT / asset).read_bytes()).hexdigest()
                if served == stamp:
                    self.assertEqual(
                        actual,
                        digest,
                        f'{asset} changed while its ?v= stamp ({served}) did not: bump the '
                        'stamp in the template so a returning visitor is not served the old '
                        'file against new markup, then re-cut CACHE_BUSTING_STAMPS.',
                    )
                else:
                    self.assertEqual(
                        (served, actual),
                        (stamp, digest),
                        f'{asset} is served under ?v={served} but this table records '
                        f'{stamp}: re-cut CACHE_BUSTING_STAMPS with the new stamp and digest.',
                    )


if __name__ == '__main__':  # pragma: no cover - manual runs
    unittest.main()
