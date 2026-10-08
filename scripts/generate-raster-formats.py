#!/usr/bin/env python3
"""Modern-format, responsive siblings for the 3D raster scenes.

The illustration library is SVG first: every page renders a vector diagram, and the
`*-3d.jpg` scenes are an upgrade layered on top of it. Those JPEGs are the only rasters the
site serves, and they are wide — 1280×698 or 1376×768 — while the CSS box they render into
is at most 664 px (`--ch-width: 1240px`, two-column `.ch-split`). A phone therefore used to
download the full 72 KB scene to paint a 390 px-wide column.

This writes a width ladder plus AVIF/WebP encodings next to each JPEG:

    <stem>-640.{webp,avif}   <stem>-960.{webp,avif}   <stem>-1280.{webp,avif}

so `templates/cloudhost247/includes/visual.tpl` and the SPA's `Illustration` component can
declare AVIF → WebP → JPEG with `sizes`, and the browser fetches the smallest file that
covers the pixels it is about to paint. Nothing is deleted: the original `.jpg` stays as the
single-entry JPEG fallback and the `.svg` stays underneath as the `<img>` contract.

Widths are capped at the source width, and every variant is checked against the JPEG — if an
encoding ever costs *more* bytes than the file it is meant to replace it is reported rather
than quietly shipped.

ImageMagick is the converter because it is already present, `convert -list format` shows
both codecs, and it needs no Python wheels.

The platform serves the same library a second time, from
`cloudhost247-node/frontend/public/media/cloudhost247`. That is Vite's public directory: a build
empties `cloudhost247-node/public` and copies the public directory into it
(`frontend/vite.config.ts` sets `outDir: ../public` with `emptyOutDir: true`), so the public
directory is the copy that has to be right and the build output is not a place to store anything.
`--emit-served` refreshes it from here and prunes anything the library no longer defines, so the
built SPA cannot be one generation behind the theme — a `<picture>` that advertises a missing
`-960.avif` does not fall back, it shows nothing.

    python3 scripts/generate-raster-formats.py                      # write what is missing
    python3 scripts/generate-raster-formats.py --force              # rewrite every variant
    python3 scripts/generate-raster-formats.py --check              # fail if the ladder is incomplete
    python3 scripts/generate-raster-formats.py --emit-served        # + sync the platform's copy
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / 'assets/images/cloudhost247'
# The platform's second copy of the same library. It is tracked, so `--emit-served` output belongs
# in a commit; `cloudhost247-node/.gitignore` ignores the *build output* (`public/*`), not this.
SERVED = ROOT / 'cloudhost247-node/frontend/public/media/cloudhost247'
# Not artwork: the library's own notes and the generated index of the mark families.
NOT_SERVED = ('README.md', 'catalogue-marks.json')

# The three steps the templates advertise. `sizes` in `visual.tpl` resolves to 664 px at the
# top end, so 1280 w covers a 2× display and 640 w covers a 1× phone.
LADDER = (640, 960, 1280)

# Quality settings chosen by comparing against the JPEG at 100 %: these are flat,
# vector-derived scenes, so both codecs hold up well at these values and the difference is not
# visible at the sizes the site renders.
FORMATS = {
    'webp': ['-quality', '82', '-define', 'webp:method=6'],
    'avif': ['-quality', '60'],
}


def require_imagemagick() -> str:
    convert = shutil.which('convert')
    if not convert:
        sys.exit('ImageMagick `convert` is not on PATH; cannot write raster variants.')
    listed = subprocess.run([convert, '-list', 'format'], capture_output=True, text=True).stdout
    missing = [name for name in FORMATS if name.upper() not in listed.upper()]
    if missing:
        sys.exit('ImageMagick was built without: ' + ', '.join(missing) + ' (see `convert -list format`).')
    return convert


def native_width(jpeg: Path) -> int:
    identify = shutil.which('identify')
    if not identify:
        sys.exit('ImageMagick `identify` is not on PATH; cannot measure the rasters.')
    result = subprocess.run(
        [identify, '-format', '%w', str(jpeg)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not result.stdout.strip().isdigit():
        sys.exit(f'cannot read the pixel width of {jpeg.relative_to(ROOT)}: {result.stderr.strip()}')
    return int(result.stdout.strip())


def widths_for(width: int, source: Path) -> list[int]:
    """The ladder steps to encode, or a hard stop if the scene is too small to fill it.

    The `<picture>` markup in `visual.tpl` and `Illustration.tsx` advertises these three widths
    literally, so a scene that is narrower would leave a step unresolvable and the srcset would
    point at a file that does not exist. Refusing here is better than shipping a 404.
    """
    top = max(LADDER)
    if width < top:
        sys.exit(
            f'{source.relative_to(ROOT)} is {width}px wide, narrower than the largest ladder step '
            f'({top}px). Either supply the scene at {top}px or wider, or add {width} to LADDER here '
            f'and to the srcset in templates/cloudhost247/includes/visual.tpl.'
        )
    return list(LADDER)


def variants(jpeg: Path, extension: str) -> list[tuple[Path, int]]:
    """(path, resize width) pairs for one format — every step is resized explicitly."""
    stem = jpeg.with_suffix('')
    return [(stem.parent / f'{stem.name}-{step}.{extension}', step) for step in LADDER]


def emit_served() -> int:
    """Mirror the library into the platform's build output, pruning what it no longer defines."""
    if not SERVED.parent.is_dir():
        sys.exit(f'{SERVED.relative_to(ROOT)}/.. does not exist; build the platform frontend first.')
    wanted: set[Path] = set()
    copied = pruned = 0
    for source in sorted(LIBRARY.rglob('*')):
        if not source.is_file() or source.name in NOT_SERVED:
            continue
        relative = source.relative_to(LIBRARY)
        wanted.add(relative)
        target = SERVED / relative
        if target.is_file() and target.stat().st_size == source.stat().st_size \
                and target.read_bytes() == source.read_bytes():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied += 1
    for stale in sorted(SERVED.rglob('*')):
        if stale.is_file() and stale.relative_to(SERVED) not in wanted:
            stale.unlink()
            pruned += 1
    for directory in sorted((p for p in SERVED.rglob('*') if p.is_dir()), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()
    print(f'served mirror: {copied} copied, {pruned} pruned · {len(wanted)} files at '
          f'{SERVED.relative_to(ROOT)}')
    return 0


def encode(convert: str, source: Path, target: Path, width: int, options: list[str]) -> None:
    command = [convert, str(source), '-resize', f'{width}x>', *options, str(target)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        sys.exit(f'failed to write {target.relative_to(ROOT)}: {result.stderr.strip()}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--force', action='store_true', help='rewrite variants that already exist')
    parser.add_argument('--check', action='store_true', help='write nothing; fail if a variant is missing')
    parser.add_argument('--emit-served', action='store_true',
                        help="also refresh the platform's frontend/public/media/cloudhost247")
    args = parser.parse_args()

    convert = require_imagemagick()
    jpegs = sorted(LIBRARY.rglob('*.jpg'))
    if not jpegs:
        sys.exit(f'no rasters found under {LIBRARY.relative_to(ROOT)}')

    written = skipped = 0
    jpeg_bytes = variant_bytes = 0
    oversized: list[str] = []
    missing: list[str] = []
    # A single-resolution variant left over from an earlier naming scheme would be dead weight
    # in the release archive; flag anything that is not part of the ladder the templates use.
    orphaned: list[str] = []

    for jpeg in jpegs:
        widths_for(native_width(jpeg), jpeg)
        jpeg_bytes += jpeg.stat().st_size
        wanted: set[Path] = set()
        for extension, options in FORMATS.items():
            for target, resize in variants(jpeg, extension):
                wanted.add(target)
                if args.check:
                    if not target.is_file():
                        missing.append(str(target.relative_to(ROOT)))
                    continue
                if target.exists() and not args.force:
                    skipped += 1
                    variant_bytes += target.stat().st_size
                    continue
                encode(convert, jpeg, target, resize, options)
                written += 1
                variant_bytes += target.stat().st_size
                # A "modern format" that costs more bytes than the JPEG is not an improvement,
                # and offering it in <picture> would make every visitor pay for it.
                if resize == max(LADDER) and target.stat().st_size >= jpeg.stat().st_size:
                    oversized.append(
                        f'{target.relative_to(ROOT)} ({target.stat().st_size} >= {jpeg.stat().st_size})'
                    )
        orphaned += [
            str(other.relative_to(ROOT))
            for extension in FORMATS
            for other in (jpeg.with_suffix(f'.{extension}'),)
            if other.is_file() and other not in wanted
        ]

    if args.check:
        if missing:
            sys.stderr.write(f'✖ {len(missing)} raster variant(s) missing:\n')
            for name in missing[:10]:
                sys.stderr.write(f'  - {name}\n')
            return 1
        print(f'✓ raster ladder complete: {len(jpegs)} scenes × {len(FORMATS)} formats')
        return 0

    if orphaned:
        sys.stderr.write('✖ variants outside the advertised ladder (delete them, nothing links to them):\n')
        for name in orphaned:
            sys.stderr.write(f'  - {name}\n')
        return 1

    saved = 100 * (1 - variant_bytes / (jpeg_bytes * len(LADDER))) if jpeg_bytes else 0
    print(f'raster variants: {written} written, {skipped} already present')
    print(f'  {len(jpegs)} scenes · jpeg {jpeg_bytes / 1024:.0f} KB · ladder {variant_bytes / 1024:.0f} KB'
          f' · {saved:.0f}% under the equivalent byte count')
    if oversized:
        print('  larger than the JPEG (left in place, but worth re-checking):')
        for name in oversized:
            print(f'    {name}')
    if args.emit_served:
        return emit_served()
    return 0


if __name__ == '__main__':
    sys.exit(main())
