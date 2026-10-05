#!/usr/bin/env python3
"""Regenerate tests/fixtures/qr-reference.json from an independent QR implementation.

The point of this file is *independence*: the platform's encoder in src/lib/qr.js must reproduce
these matrices exactly, and the reference here comes from python-qrcode (`qrcode` 8.2) — a mature
implementation that follows ISO/IEC 18004's pad-codeword rule literally:

    terminator (up to four 0 bits) → pad to the byte boundary only if needed → alternate 0xEC/0x11

Setup and run, from platform/:

    python3 -m venv /tmp/qrvenv
    /tmp/qrvenv/bin/pip install 'qrcode==8.2' 'segno==1.6.6'
    /tmp/qrvenv/bin/python tests/fixtures/generate-qr-fixtures.py

The tests never need either library — they read the committed JSON.

**Why segno is not the reference for the matrices.** segno 1.6.6 emits an extra 0x00 pad codeword
whenever the bit stream is already byte-aligned after the terminator (its `write_padding_bits()`
adds `8 - length % 8` bits, i.e. a full byte when `length % 8 == 0`), which is not what ISO 7.4.10
describes and not what python-qrcode does. Such codes still scan — decoders stop at the terminator —
but they carry one more pad codeword than the spec allows. One segno matrix is kept as
`segno_padding_deviation` so the difference is pinned by a test instead of being folklore.

Mask *choice* is not part of the reference: every mask is legal, and implementations disagree
(python-qrcode scores with a 4-module light border included; segno and src/lib/qr.js score the bare
matrix). The fixtures therefore force a mask for every matrix comparison, and the tests separately
pin the ISO penalty rules and check that all eight masks carry identical codewords.
"""
import hashlib
import json
import pathlib
import sys

import qrcode
from importlib.metadata import version as package_version
from qrcode import constants as qc
from qrcode.util import MODE_8BIT_BYTE, QRData

QRCODE_VERSION = package_version('qrcode')

try:
    import segno
    import segno.encoder
except ImportError:  # optional: only needed to refresh the documented deviation case
    segno = None

LEVELS = {
    'L': qc.ERROR_CORRECT_L,
    'M': qc.ERROR_CORRECT_M,
    'Q': qc.ERROR_CORRECT_Q,
    'H': qc.ERROR_CORRECT_H,
}
ALL_LEVELS = ['L', 'M', 'Q', 'H']
# Every mask at these versions; one mask at the rest, which still exercises their block tables.
MASK_SWEEP_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 27, 32, 40]
PREFIX = 'cloudhost247-v{version}-{level}-'
MAX_LENGTH_CACHE = {}


def make_text(version: int, level: str, length: int) -> str:
    """Deterministic ASCII filler — mirrored exactly in tests/qr.test.js."""
    base = PREFIX.format(version=version, level=level)
    return (base * (length // len(base) + 1))[:length]


def bit_rows(modules) -> list[str]:
    """Row-major '1'/'0' serialisation — must match qr.toBitRows() in src/lib/qr.js."""
    return [''.join('1' if cell else '0' for cell in row) for row in modules]


def sha_of_rows(rows: list[str]) -> str:
    return hashlib.sha256('\n'.join(rows).encode('ascii')).hexdigest()


def render(text: str, version: int, level: str, mask):
    """One python-qrcode matrix, byte mode, no version search, no error-level boosting."""
    qr = qrcode.QRCode(version=version, error_correction=LEVELS[level], box_size=1, border=0,
                       mask_pattern=mask)
    qr.add_data(QRData(text.encode('utf-8'), mode=MODE_8BIT_BYTE), optimize=0)
    qr.make(fit=False)
    if qr.version != version:
        raise SystemExit(f'python-qrcode produced version {qr.version} for requested {version}')
    return qr.modules


def max_fitting_length(version: int, level: str) -> int:
    """Largest byte-mode payload python-qrcode accepts for this version/level (binary search)."""
    key = (version, level)
    if key in MAX_LENGTH_CACHE:
        return MAX_LENGTH_CACHE[key]
    low, high, best = 1, 3000, None
    while low <= high:
        mid = (low + high) // 2
        try:
            render(make_text(version, level, mid), version, level, 0)
            best = mid
            low = mid + 1
        except Exception:
            high = mid - 1
    if best is None:
        raise SystemExit(f'no payload fits version {version} level {level}')
    MAX_LENGTH_CACHE[key] = best
    return best


def case(version: int, level: str, length: int, mask: int, full: bool = False,
         forces_version: bool = False) -> dict:
    text = make_text(version, level, length)
    rows = bit_rows(render(text, version, level, mask))
    entry = {
        'version': version,
        'ecLevel': level,
        'mask': mask,
        'requestedMask': mask,
        'size': len(rows),
        'textLength': length,
        # The payload is the largest that fits, so no earlier version can hold it: the encoder's
        # own version search must land on this version without being told.
        'forcesVersion': forces_version,
        'sha256': sha_of_rows(rows),
    }
    if full:
        entry['rows'] = rows
    return entry


def main() -> int:
    cases = []

    # 1. Every mask at a spread of versions and at every EC level.
    for version in MASK_SWEEP_VERSIONS:
        for level in ALL_LEVELS:
            length = max(1, max_fitting_length(version, level) // 2)
            for mask in range(8):
                cases.append(case(version, level, length, mask, full=(version <= 2)))

    # 2. Every remaining version at every level, one mask, to exercise its block tables.
    for version in range(1, 41):
        if version in MASK_SWEEP_VERSIONS:
            continue
        for level in ALL_LEVELS:
            length = max_fitting_length(version, level)
            cases.append(case(version, level, length, 3, forces_version=True))

    # 3. Every version at every level with a payload that exactly fills it — the no-pad-codeword
    #    boundary, where the terminator is shortened.
    for version in range(1, 41):
        for level in ALL_LEVELS:
            length = max_fitting_length(version, level)
            cases.append(case(version, level, length, 0, forces_version=True))

    # 4. A realistic otpauth:// URI — the payload this encoder exists for.
    uri = ('otpauth://totp/CloudHost247:ada%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
           '&issuer=CloudHost247&algorithm=SHA1&digits=6&period=30')
    for level in ALL_LEVELS:
        version = qrcode.QRCode(error_correction=LEVELS[level], box_size=1, border=0)
        version.add_data(QRData(uri.encode('utf-8'), mode=MODE_8BIT_BYTE), optimize=0)
        version.make(fit=True)
        rows = bit_rows(render(uri, version.version, level, 0))
        cases.append({
            'version': version.version, 'ecLevel': level, 'mask': 0, 'requestedMask': 0,
            'size': len(rows), 'text': uri, 'forcesVersion': True,
            'sha256': sha_of_rows(rows), 'rows': rows,
        })

    # Scores for the penalty rules, from segno's independent implementation, on matrices that carry
    # no pad codewords (so the two encoders produce identical matrices and the scores are
    # comparable). Mask choice itself is not compared: every mask is legal.
    score_checks = []
    if segno is not None:
        for level in ALL_LEVELS:
            version = 3
            length = max_fitting_length(version, level)
            text = make_text(version, level, length)
            for mask in range(8):
                qr = segno.make(text, error=level, version=version, mode='byte',
                                boost_error=False, mask=mask)
                rows = bit_rows(qr.matrix)
                assert rows == bit_rows(render(text, version, level, mask)), 'encoders must agree here'
                n1, n2, n3, n4 = segno.encoder.mask_scores(
                    [bytearray(int(c) for c in row) for row in rows], len(rows), len(rows))
                score_checks.append({
                    'version': version, 'ecLevel': level, 'mask': mask, 'textLength': length,
                    'n1': n1, 'n2': n2, 'n3': n3, 'n4': n4, 'total': n1 + n2 + n3 + n4,
                })

    # Synthetic matrices, scored by the same independent implementation. These pin each of the
    # four penalty rules in isolation (runs, blocks, finder patterns, dark/light balance), which a
    # real symbol mixes together.
    score_examples = []
    if segno is not None:
        def score_example(name, rows):
            n1, n2, n3, n4 = segno.encoder.mask_scores(
                [bytearray(r) for r in rows], len(rows), len(rows))
            score_examples.append({
                'name': name, 'rows': [''.join(str(c) for c in r) for r in rows],
                'n1': n1, 'n2': n2, 'n3': n3, 'n4': n4, 'total': n1 + n2 + n3 + n4,
            })

        size = 21
        light = [[0] * size for _ in range(size)]
        score_example('all-light', light)

        one_dark = [r[:] for r in light]
        one_dark[10][10] = 1
        score_example('one-dark-module', one_dark)

        pair = [r[:] for r in light]
        pair[10][10] = pair[10][11] = 1
        score_example('two-adjacent-dark', pair)

        pattern = [r[:] for r in light]
        for x in (0, 2, 3, 4, 6):
            pattern[10][x] = 1
        score_example('finder-pattern-no-light-area', pattern)

        spaced = [r[:] for r in light]
        for x in (6, 8, 9, 10, 12):
            spaced[10][x] = 1  # 1:1:3:1:1 with light modules on both sides
        score_example('finder-pattern-with-light-area', spaced)

    payload = {
        'reference': f'python-qrcode {QRCODE_VERSION} (mode=8BIT_BYTE, optimize=0)',
        'score_reference': f'segno {segno.__version__}' if segno is not None else None,
        'scoreChecks': score_checks,
        'scoreExamples': score_examples,
        'note': 'Generated by tests/fixtures/generate-qr-fixtures.py — do not hand-edit.',
        'cases': cases,
    }

    if segno is not None:
        # The documented deviation: same payload, same version, same mask — and the matrices differ
        # only from the 11th codeword on, where segno pads with 0x00 before 0xEC/0x11.
        text = make_text(1, 'L', 8)
        payload['segno_padding_deviation'] = {
            'reference': f'segno {segno.__version__}',
            'version': 1, 'ecLevel': 'L', 'mask': 0, 'textLength': 8,
            'rows': bit_rows(segno.make(text, error='L', version=1, mode='byte',
                                        boost_error=False, mask=0).matrix),
        }

    out = pathlib.Path(__file__).with_name('qr-reference.json')
    out.write_text(json.dumps(payload, indent=1) + '\n', encoding='utf-8')
    print(f'wrote {out} — {len(cases)} matrix cases'
          + (' (+ segno deviation case)' if 'segno_padding_deviation' in payload else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
